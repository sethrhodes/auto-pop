const express = require("express");
require("dotenv").config();
const path = require("path");
const { createTestProduct, createProduct } = require("./wooClient");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Route to create a test product in WooCommerce
app.post("/debug/create-test-product", async (req, res) => {
  try {
    const product = await createTestProduct();
    res.status(201).json(product);
  } catch (err) {
    console.error("Error creating product:");

    if (err.response) {
      console.error(err.response.data);
      res
        .status(500)
        .json({ error: "WooCommerce error", details: err.response.data });
    } else {
      console.error(err.message);
      res.status(500).json({ error: "Server error", details: err.message });
    }
  }
});

// New route: create a product from request body
app.post("/products", async (req, res) => {
  try {
    const { name, price, quantity } = req.body;

    if (!name || !price) {
      return res.status(400).json({ error: "name and price are required" });
    }

    const product = await createProduct({ name, price, quantity });
    res.status(201).json(product);
  } catch (err) {
    console.error("Error creating product:");
    if (err.response) {
      console.error(err.response.data);
      res
        .status(500)
        .json({ error: "WooCommerce error", details: err.response.data });
    } else {
      console.error(err.message);
      res.status(500).json({ error: "Server error", details: err.message });
    }
  }
});

app.listen(port, () => {
  console.log(`auto-pop backend listening on http://localhost:${port}`);
});