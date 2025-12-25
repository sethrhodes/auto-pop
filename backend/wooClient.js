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
  const baseURL = apiKeys.WC_BASE_URL || process.env.WC_BASE_URL;
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
async function createProduct({ name, price, sku, quantity = 1, description, short_description, images = [], apiKeys = {} }) {
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
  };

  try {
    const response = await api.post("/products", payload);
    console.log("Product Created ID:", response.data.id);
    return response.data;
  } catch (err) {
    // Handle SKU Conflict (Upsert)
    // Code 'woocommerce_rest_product_not_created' often means SKU exists. 'product_invalid_sku' is another.
    if (err.response && (err.response.data.code === 'woocommerce_rest_product_not_created' || err.response.data.code === 'product_invalid_sku')) {
      console.log(`SKU conflict for ${sku}. Attempting update existing product...`);

      // 1. Find the existing product via SKU (including Trash)
      // Note: WooCommerce API might require 'status' param to find trash
      let search = await api.get(`/products?sku=${encodeURIComponent(sku)}`); // Try default first (publish/draft)

      if (!search.data || search.data.length === 0) {
        // Try searching specifically for trash
        try {
          // Some Woo versions need 'trash' explicitly
          const trashSearch = await api.get(`/products?sku=${encodeURIComponent(sku)}&status=trash`);
          if (trashSearch.data && trashSearch.data.length > 0) search = trashSearch;
        } catch (e) { console.log("Trash search failed", e.message); }
      }

      if (search.data && search.data.length > 0) {
        const existingId = search.data[0].id;
        console.log(`Found existing product ID: ${existingId}. Updating...`);

        // 2. data-driven Update
        const updateRes = await api.put(`/products/${existingId}`, payload);
        return updateRes.data;
      } else {
        // SKU exists but not found via search?
        console.warn("SKU exists in lookup table but product not found via API.");
        throw new Error(`SKU ${sku} is taken by a deleted product. Go to WooCommerce > Products > Trash and 'Delete Permanently', then try again.`);
      }
    }

    throw err; // Re-throw other errors
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
    status: "publish"
  };

  const response = await api.put(`/products/${id}`, payload);
  console.log("Product Updated ID:", response.data.id);
  return response.data;
}

module.exports = {
  createTestProduct,
  createProduct,
  updateProductStockBySku,
  updateProduct
};