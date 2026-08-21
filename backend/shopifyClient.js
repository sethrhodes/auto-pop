// backend/shopifyClient.js
// Shopify Admin GraphQL API client.
// Matches products in the Shopify store by BARCODE and updates them in place.
const axios = require("axios");
require("dotenv").config();

const API_VERSION = "2026-01";

function resolveKeys(apiKeys = {}) {
  return {
    domain: apiKeys.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN,
    staticToken: apiKeys.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN,
    clientId: apiKeys.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_CLIENT_ID,
    clientSecret: apiKeys.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_CLIENT_SECRET,
  };
}

/**
 * True when Shopify credentials are available (user settings or .env).
 * Accepts either a legacy static admin token, or Dev Dashboard
 * Client ID + Client Secret (client credentials grant).
 * Used by the publish route to decide whether to target Shopify.
 */
function isConfigured(apiKeys = {}) {
  const { domain, staticToken, clientId, clientSecret } = resolveKeys(apiKeys);
  return Boolean(domain && (staticToken || (clientId && clientSecret)));
}

function getConfig(apiKeys = {}) {
  let { domain, staticToken, clientId, clientSecret } = resolveKeys(apiKeys);
  if (!domain || !(staticToken || (clientId && clientSecret))) {
    throw new Error("Shopify credentials missing. Set Store Domain plus either Client ID + Client Secret (Dev Dashboard app) or a static Admin token.");
  }
  // Accept any of: my-store.myshopify.com, https://my-store.myshopify.com/...,
  // or an admin URL like https://admin.shopify.com/store/my-store
  const adminMatch = domain.match(/admin\.shopify\.com\/store\/([^\/?#]+)/);
  if (adminMatch) {
    domain = `${adminMatch[1]}.myshopify.com`;
  } else {
    domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
  return { domain, staticToken, clientId, clientSecret };
}

// Dev Dashboard apps issue 24h tokens via the client credentials grant.
// Cache per shop+client so we only re-request when a token is near expiry.
const tokenCache = {};

async function getAccessToken(config) {
  if (config.staticToken) return config.staticToken;

  const cacheKey = `${config.domain}|${config.clientId}`;
  const cached = tokenCache[cacheKey];
  if (cached && cached.expiresAt > Date.now() + 60 * 1000) {
    return cached.token;
  }

  console.log(`[Shopify] Requesting access token for ${config.domain}...`);
  try {
    const res = await axios.post(
      `https://${config.domain}/admin/oauth/access_token`,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const { access_token, expires_in } = res.data;
    tokenCache[cacheKey] = {
      token: access_token,
      expiresAt: Date.now() + (expires_in || 86399) * 1000,
    };
    return access_token;
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Shopify token request failed (is the app installed on the store?): ${detail}`);
  }
}

async function gql(config, query, variables = {}) {
  const token = await getAccessToken(config);
  const res = await axios.post(
    `https://${config.domain}/admin/api/${API_VERSION}/graphql.json`,
    { query, variables },
    {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    }
  );
  if (res.data.errors) {
    throw new Error(`Shopify API error: ${JSON.stringify(res.data.errors)}`);
  }
  return res.data.data;
}

function logUserErrors(label, userErrors) {
  if (userErrors && userErrors.length > 0) {
    console.warn(`[Shopify] ${label} userErrors:`, JSON.stringify(userErrors));
    return true;
  }
  return false;
}

/**
 * Find a product whose variant barcode (or SKU, as fallback) matches.
 * Returns { productId, title } or null.
 */
async function findProductByBarcode(barcode, apiKeys = {}) {
  const config = getConfig(apiKeys);
  return findProduct(config, [barcode]);
}

async function findProduct(config, candidates) {
  const query = `
    query FindVariants($q: String!) {
      productVariants(first: 20, query: $q) {
        edges {
          node {
            id
            sku
            barcode
            product { id title }
          }
        }
      }
    }`;

  const clean = [...new Set(candidates.filter(Boolean).map(String))];

  for (const field of ["barcode", "sku"]) {
    for (const value of clean) {
      const data = await gql(config, query, { q: `${field}:${JSON.stringify(value)}` });
      const edges = data.productVariants?.edges || [];
      // The search can be fuzzy; require an exact field match.
      const hit = edges.find(
        (e) => e.node.barcode === value || e.node.sku === value
      );
      if (hit) {
        console.log(`[Shopify] Matched ${field} "${value}" -> ${hit.node.product.title} (${hit.node.product.id})`);
        return { productId: hit.node.product.id, title: hit.node.product.title };
      }
    }
  }

  // STYLE MATCH: the parent style code (e.g. NCHOGBLK) should match remote
  // variants that carry a size suffix (NCHOGBLKS, NCHOGBLK-M, ...). Prefix
  // search, then verify: remote value minus size suffix === style code.
  const SIZE_SUFFIX = /[-_ ]?(XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL)$/i;
  const normalize = (s) => String(s).toUpperCase().replace(/[-_ ]/g, "");

  for (const field of ["sku", "barcode"]) {
    for (const value of clean) {
      if (!/^[A-Za-z0-9-]+$/.test(value)) continue; // keep the search query well-formed
      const data = await gql(config, query, { q: `${field}:${value}*` });
      const edges = data.productVariants?.edges || [];
      const hit = edges.find((e) => {
        const fv = e.node[field] || "";
        return normalize(fv.replace(SIZE_SUFFIX, "")) === normalize(value);
      });
      if (hit) {
        console.log(`[Shopify] Style-matched ${field} "${value}" via variant "${hit.node[field] || hit.node.sku}" -> ${hit.node.product.title} (${hit.node.product.id})`);
        return { productId: hit.node.product.id, title: hit.node.product.title };
      }
    }
  }

  return null;
}

async function getProductVariants(config, productId) {
  const data = await gql(config, `
    query ProductVariants($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          edges {
            node {
              id
              sku
              barcode
              inventoryItem { id }
            }
          }
        }
        media(first: 100) {
          edges { node { id } }
        }
      }
    }`, { id: productId });

  return {
    variants: (data.product?.variants?.edges || []).map((e) => e.node),
    mediaIds: (data.product?.media?.edges || []).map((e) => e.node.id),
  };
}

/**
 * Website tag by product gender, e.g. "Mens Website".
 */
function websiteTagFor(gender) {
  const g = String(gender || "").toLowerCase();
  if (g === "men" || g === "mens") return "Mens Website";
  if (g === "women" || g === "womens") return "Womens Website";
  if (g === "kids" || g === "boys" || g === "girls") return "Kids Website";
  return null; // unisex/unknown: no tag
}

/**
 * Append tags to a product (tagsAdd never removes existing tags).
 */
async function addProductTags(config, productId, tags) {
  if (!tags || tags.length === 0) return;
  try {
    const data = await gql(config, `
      mutation AddTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }`, { id: productId, tags });
    if (!logUserErrors("tagsAdd", data.tagsAdd?.userErrors)) {
      console.log(`[Shopify] Tagged product with: ${tags.join(", ")}`);
    }
  } catch (e) {
    console.warn("[Shopify] Failed to add tags (continuing):", e.message);
  }
}

// Publication ("sales channel") id cache per shop — the Online Store id never changes.
const publicationCache = {};

async function getOnlineStorePublicationId(config) {
  if (publicationCache[config.domain] !== undefined) return publicationCache[config.domain];
  try {
    const data = await gql(config, `query { publications(first: 20) { edges { node { id name } } } }`);
    const pubs = (data.publications?.edges || []).map((e) => e.node);
    const online = pubs.find((p) => /online store|web/i.test(p.name));
    if (!online) {
      console.warn("[Shopify] No Online Store publication found. Channels:", pubs.map((p) => p.name).join(", ") || "(none visible)");
    }
    publicationCache[config.domain] = online?.id || null;
    return publicationCache[config.domain];
  } catch (e) {
    // Typically a missing read_publications scope — don't cache, so it works once the scope is added.
    console.warn("[Shopify] Could not list sales channels (app may need read_publications/write_publications scopes):", e.message);
    return null;
  }
}

/**
 * Set the product ACTIVE and publish it to the Online Store sales channel.
 * Both steps are tolerant: failures log a warning but never block the publish.
 */
async function setActiveAndPublishToOnlineStore(config, productId) {
  try {
    const d = await gql(config, `
      mutation Activate($product: ProductUpdateInput!) {
        productUpdate(product: $product) { userErrors { field message } }
      }`, { product: { id: productId, status: "ACTIVE" } });
    if (!logUserErrors("productUpdate(status)", d.productUpdate?.userErrors)) {
      console.log("[Shopify] Product status set to ACTIVE.");
    }
  } catch (e) {
    console.warn("[Shopify] Failed to set product ACTIVE (continuing):", e.message);
  }

  const publicationId = await getOnlineStorePublicationId(config);
  if (!publicationId) return;
  try {
    const d = await gql(config, `
      mutation PublishToChannel($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }`, { id: productId, input: [{ publicationId }] });
    if (!logUserErrors("publishablePublish", d.publishablePublish?.userErrors)) {
      console.log("[Shopify] Product published to Online Store channel.");
    }
  } catch (e) {
    console.warn("[Shopify] Failed to publish to Online Store channel (continuing):", e.message);
  }
}

/**
 * Update core product content (title, description).
 */
async function updateProductContent(config, productId, { name, description, short_description }) {
  const data = await gql(config, `
    mutation UpdateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id title }
        userErrors { field message }
      }
    }`, {
    product: {
      id: productId,
      title: name,
      descriptionHtml: description || short_description || "",
    },
  });
  const errs = data.productUpdate?.userErrors;
  if (logUserErrors("productUpdate", errs)) {
    throw new Error(`Shopify product update failed: ${errs.map((e) => e.message).join("; ")}`);
  }
  return data.productUpdate.product;
}

/**
 * Replace the product's media with the provided image URLs.
 * (Mirrors the Woo behavior where the images array replaces the set.)
 */
async function replaceProductMedia(config, productId, imageUrls, existingMediaIds) {
  if (!imageUrls || imageUrls.length === 0) return;

  if (existingMediaIds && existingMediaIds.length > 0) {
    try {
      const del = await gql(config, `
        mutation DeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            mediaUserErrors { field message }
          }
        }`, { productId, mediaIds: existingMediaIds });
      logUserErrors("productDeleteMedia", del.productDeleteMedia?.mediaUserErrors);
    } catch (e) {
      console.warn("[Shopify] Failed to delete old media (continuing):", e.message);
    }
  }

  const media = imageUrls.map((url) => ({
    originalSource: url,
    mediaContentType: "IMAGE",
  }));

  const add = await gql(config, `
    mutation CreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }`, { productId, media });
  logUserErrors("productCreateMedia", add.productCreateMedia?.mediaUserErrors);
}

/**
 * Create a brand-new product (used only when no barcode match exists).
 * Created as DRAFT so nothing goes live without review in Shopify admin.
 */
async function createProduct(config, { name, price, barcode, sku, description, short_description, images = [], variants = [] }) {
  const hasVariants = Array.isArray(variants) && variants.length > 0;
  const sizes = hasVariants ? [...new Set(variants.map((v) => v.size).filter(Boolean))] : [];

  const productInput = {
    title: name,
    descriptionHtml: description || short_description || "",
    status: "DRAFT",
  };
  if (sizes.length > 0) {
    productInput.productOptions = [{ name: "Size", values: sizes.map((s) => ({ name: s })) }];
  }

  const media = (images || []).map((url) => ({
    originalSource: url,
    mediaContentType: "IMAGE",
  }));

  const data = await gql(config, `
    mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product {
          id
          title
          variants(first: 1) { edges { node { id } } }
        }
        userErrors { field message }
      }
    }`, { product: productInput, media });

  const errs = data.productCreate?.userErrors;
  if (logUserErrors("productCreate", errs) && !data.productCreate?.product) {
    throw new Error(`Shopify product create failed: ${errs.map((e) => e.message).join("; ")}`);
  }
  const product = data.productCreate.product;

  if (sizes.length > 0) {
    // Replace the default variant with the real size run.
    const variantInputs = variants.map((v) => ({
      optionValues: [{ optionName: "Size", name: v.size || "Standard" }],
      price: String(v.price || price),
      barcode: String(v.sku || ""),
      inventoryItem: { sku: String(v.sku || ""), tracked: true },
    }));

    const bulk = await gql(config, `
      mutation CreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
          productVariants { id }
          userErrors { field message }
        }
      }`, { productId: product.id, variants: variantInputs, strategy: "REMOVE_STANDALONE_VARIANT" });
    logUserErrors("productVariantsBulkCreate", bulk.productVariantsBulkCreate?.userErrors);

    // Inventory quantities are intentionally NOT set — the POS owns stock.
  } else {
    // Single variant: set price + barcode/sku on the default variant.
    const defaultVariantId = product.variants?.edges?.[0]?.node?.id;
    if (defaultVariantId) {
      const upd = await gql(config, `
        mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }`, {
        productId: product.id,
        variants: [{
          id: defaultVariantId,
          price: String(price),
          barcode: String(barcode || sku || ""),
          inventoryItem: { sku: String(sku || ""), tracked: true },
        }],
      });
      logUserErrors("productVariantsBulkUpdate(create)", upd.productVariantsBulkUpdate?.userErrors);
    }
  }

  return product;
}

/**
 * MAIN ENTRY: Publish a product to Shopify, matching by barcode.
 * - Looks up the store for a variant whose barcode (or SKU) matches the
 *   product barcode, the parent SKU, or any variant SKU.
 * - If found: updates that product in place (title, description, images,
 *   tag, active + Online Store). Price and inventory are NEVER touched —
 *   the POS owns both.
 * - If not found: creates a new DRAFT product carrying the barcode.
 *
 * Returns { product: {id, title}, action: 'updated' | 'created' }
 */
async function publishProductByBarcode({ name, price, barcode, sku, quantity = 1, description, short_description, images = [], variants = [], gender = null, apiKeys = {} }) {
  const config = getConfig(apiKeys);
  const websiteTag = websiteTagFor(gender);

  const candidates = [barcode, sku, ...(variants || []).map((v) => v.sku)];
  const match = await findProduct(config, candidates);

  if (match) {
    console.log(`[Shopify] Updating existing product "${match.title}" by barcode match...`);
    const { mediaIds } = await getProductVariants(config, match.productId);
    const product = await updateProductContent(config, match.productId, { name, description, short_description });
    await replaceProductMedia(config, match.productId, images, mediaIds);
    await addProductTags(config, match.productId, websiteTag ? [websiteTag] : []);
    await setActiveAndPublishToOnlineStore(config, match.productId);
    return { product, action: "updated" };
  }

  console.log(`[Shopify] No barcode match for "${barcode || sku}". Creating new draft product...`);
  const product = await createProduct(config, { name, price, barcode, sku, quantity, description, short_description, images, variants });
  await addProductTags(config, product.id, websiteTag ? [websiteTag] : []);
  await setActiveAndPublishToOnlineStore(config, product.id);
  return { product, action: "created" };
}

module.exports = {
  isConfigured,
  findProductByBarcode,
  publishProductByBarcode,
};
