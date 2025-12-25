// backend/wooClient.js
const axios = require("axios");
const https = require("https");
require("dotenv").config();

const agent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Get configured Woo API client
 */
function getWooClient(apiKeys = {}) {
  let baseURL = apiKeys.WC_BASE_URL || process.env.WC_BASE_URL;
  if (baseURL) {
    if (!baseURL.startsWith("http")) {
      baseURL = `https://${baseURL}`;
    }
    if (baseURL.endsWith("/")) {
      baseURL = baseURL.slice(0, -1);
    }
    // Append standard Woo V3 API path if not present
    if (!baseURL.includes("/wp-json")) {
      baseURL += "/wp-json/wc/v3";
    }
  }
  const consumerKey = apiKeys.WC_CONSUMER_KEY || process.env.WC_CONSUMER_KEY;
  const consumerSecret = apiKeys.WC_CONSUMER_SECRET || process.env.WC_CONSUMER_SECRET;

  if (!baseURL || !consumerKey || !consumerSecret) {
    throw new Error("WooCommerce credentials missing (Settings or .env)");
  }

  return axios.create({
    baseURL,
    auth: { username: consumerKey, password: consumerSecret },
    httpsAgent: agent
  });
}

/**
 * Create a simple test product to verify connection.
 */
async function createTestProduct(apiKeys) {
  const api = getWooClient(apiKeys);
  const payload = {
    name: "Test Product from auto-pop " + Date.now(),
    type: "simple",
    regular_price: "29.99",
    description: "API test product.",
    short_description: "auto-pop test",
    manage_stock: true,
    stock_quantity: 5,
    status: "draft",
  };

  const response = await api.post("/products", payload);
  return response.data;
}

/**
 * Create a full product with images.
 */
async function createProduct({ name, price, sku, quantity = 1, description, short_description, images = [], gender, category, isHooded, apiKeys = {} }) {
  const api = getWooClient(apiKeys);
  const payload = {
    name,
    type: "simple",
    regular_price: String(price),
    sku: sku || "",
    description: description || "",
    short_description: short_description || "",
    status: "publish",
    manage_stock: true,
    stock_quantity: quantity,
    images: images,
    categories: await resolveCategories(api, { gender, category, isHooded })
  };

  try {
    const response = await api.post("/products", payload);
    console.log("Product Created ID:", response.data.id);
    return response.data;
  } catch (err) {
    if (err.response && (err.response.data.code === 'woocommerce_rest_product_not_created' || err.response.data.code === 'product_invalid_sku')) {
      console.log(`SKU conflict for ${sku}. Attempting update existing product...`);
      let search = await api.get(`/products?sku=${encodeURIComponent(sku)}`);
      if (!search.data || search.data.length === 0) {
        try {
          const trashSearch = await api.get(`/products?sku=${encodeURIComponent(sku)}&status=trash`);
          if (trashSearch.data && trashSearch.data.length > 0) search = trashSearch;
        } catch (e) { console.log("Trash search failed", e.message); }
      }

      if (search.data && search.data.length > 0) {
        const existingId = search.data[0].id;
        console.log(`Found existing product ID: ${existingId}. Updating...`);
        const updateRes = await updateProduct(existingId, {
          name, price, sku, quantity, description, short_description, images, gender, category, isHooded,
          categories: payload.categories
        }, apiKeys); // Recursive call to update with categories
        return updateRes;
      } else {
        console.warn("SKU exists in lookup table but product not found via API.");
        throw new Error(`SKU ${sku} is taken by a deleted product. Go to WooCommerce > Products > Trash and 'Delete Permanently', then try again.`);
      }
    }
    throw err;
  }
}

/**
 * Update stock quantity for a product by SKU
 */
async function updateProductStockBySku(sku, quantity, apiKeys = {}) {
  try {
    const api = getWooClient(apiKeys);
    // 1. Find Product ID by SKU
    const searchRes = await api.get(`/products?sku=${encodeURIComponent(sku)}`);
    const products = searchRes.data;

    if (!products || products.length === 0) {
      console.warn(`Woo update skipped: SKU ${sku} not found online.`);
      return false;
    }

    const productId = products[0].id;

    // 2. Update Stock
    await api.put(`/products/${productId}`, {
      manage_stock: true,
      stock_quantity: quantity
    });

    console.log(`Woo updated SKU ${sku} (ID: ${productId}) to qty=${quantity}`);
    return true;

  } catch (err) {
    console.error(`Woo update failed for SKU ${sku}:`, err.message);
    return false;
  }
}

/**
 * Update product data by ID
 */
async function updateProduct(id, data, apiKeys = {}) {
  const api = getWooClient(apiKeys);
  const payload = {
    name: data.name,
    regular_price: String(data.price),
    description: data.description,
    short_description: data.short_description,
    images: data.images,
    stock_quantity: data.quantity,
    status: "publish",
    categories: await resolveCategories(api, data)
  };

  const response = await api.put(`/products/${id}`, payload);
  console.log("Product Updated ID:", response.data.id);
  return response.data;
}

// --- CATEGORY HELPERS ---

async function resolveCategories(api, { gender, category, isHooded }) {
  console.log(`[Woo] Resolving categories for: Gender=${gender}, Cat=${category}, Hooded=${isHooded}`);
  if (!gender) return [];

  const cats = [];

  // 1. Resolve Parent Category (Gender)
  let parentName = "Guys";
  if (gender === 'women' || gender === 'womens') parentName = "Girls";
  if (gender === 'kids') parentName = "Groms";

  const parentCat = await getOrCreateCategory(api, parentName);
  if (parentCat) cats.push({ id: parentCat.id });

  // 2. Resolve Sub Category (Type)
  // Logic: Top + Hooded = Hoodies, Top + !Hooded = Tees
  // Note: Only if 'top'. Currently ignored for 'bottom' as user only specified Hats/Hoodies/Tees.
  if (category === 'top') {
    let subName = isHooded ? "Hoodies" : "Tees";
    if (parentCat) {
      const subCat = await getOrCreateCategory(api, subName, parentCat.id);
      if (subCat) cats.push({ id: subCat.id });
    }
  }

  return cats;
}

async function getOrCreateCategory(api, name, parentId = 0) {
  try {
    // Search for category
    // Note: Filtering by parent is tricky in standard API search, so we search by name and filter manually if needed, 
    // or trust unique names. "Hoodies" might exist under both Guys and Girls?
    // Woo API doesn't strictly enforce unique names across parents, but slug must be unique.

    // Attempt lookup (this is simple lookup, robust implementation might be more complex)
    const searchUrl = `/products/categories?search=${encodeURIComponent(name)}`;
    console.log(`[Woo] Searching category: ${searchUrl}`);
    const res = await api.get(searchUrl);

    // Strict matching
    let cat = res.data.find(c => c.name.toLowerCase() === name.toLowerCase() && c.parent === parentId);

    if (cat) {
      console.log(`[Woo] Found category '${name}' (ID: ${cat.id})`);
    } else {
      console.log(`[Woo] Creating category: ${name} (Parent: ${parentId})`);
      const createRes = await api.post("/products/categories", {
        name: name,
        parent: parentId
      });
      cat = createRes.data;
      console.log(`[Woo] Created category '${name}' (ID: ${cat.id})`);
    }
    return cat;
  } catch (e) {
    console.error(`[Woo] Failed to resolve category ${name}:`, e.message);
    if (e.response) console.error(JSON.stringify(e.response.data));
    return null;
  }
}

module.exports = {
  createTestProduct,
  createProduct,
  updateProductStockBySku,
  updateProduct
};