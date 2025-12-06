const axios = require("axios");
const https = require("https");
require("dotenv").config();

const agent = new https.Agent({
  // local dev: ignore self-signed SSL, same idea as curl -k
  rejectUnauthorized: false,
});

// This is your existing test helper
async function createTestProduct() {
  const baseURL = process.env.WC_BASE_URL;
  const consumerKey = process.env.WC_CONSUMER_KEY;
  const consumerSecret = process.env.WC_CONSUMER_SECRET;

  console.log("createTestProduct baseURL:", baseURL);
  console.log("createTestProduct key prefix:", consumerKey.slice(0, 10));

  const payload = {
    name: "Test Product from auto-pop",
    type: "simple",
    regular_price: "29.99",
    description: "This is a test product created via the WooCommerce REST API.",
    short_description: "auto-pop API test product",
    manage_stock: true,
    stock_quantity: 5,
    status: "draft",
  };

  const url = `${baseURL}/products`;
  console.log("POST URL:", url);

  const response = await axios.post(url, payload, {
    auth: {
      username: consumerKey,
      password: consumerSecret,
    },
    httpsAgent: agent,
  });

  return response.data;
}

// New: generic product creator that uses data from the request
async function createProduct({ name, price, quantity = 1 }) {
  const baseURL = process.env.WC_BASE_URL;
  const consumerKey = process.env.WC_CONSUMER_KEY;
  const consumerSecret = process.env.WC_CONSUMER_SECRET;

  const payload = {
    name,
    type: "simple",
    regular_price: String(price),
    status: "draft",
    manage_stock: true,
    stock_quantity: quantity,
  };

  const url = `${baseURL}/products`;
  console.log("createProduct POST URL:", url);
  console.log("Payload:", payload);

  const response = await axios.post(url, payload, {
    auth: {
      username: consumerKey,
      password: consumerSecret,
    },
    httpsAgent: agent,
  });

  return response.data;
}

module.exports = {
  createTestProduct,
  createProduct,
};