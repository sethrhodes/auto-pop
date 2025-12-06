// backend/index.js
const express = require("express");
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const { createTestProduct, createProduct } = require("./wooClient");
const { generateOnModelAndGhost } = require("./imageGenClient");
const { generateProductCopy } = require("./copyClient");
const { extractTagText } = require("./ocrClient");
const { parseTagMetadata } = require("./tagParser");

const app = express();
const port = process.env.PORT || 3000;

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || "";
    const base = file.fieldname;
    const ts = Date.now();
    cb(null, `${ts}-${base}${ext}`);
  },
});

const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Debug: create a simple WooCommerce test product
app.post("/debug/create-test-product", async (req, res) => {
  try {
    const product = await createTestProduct();
    res.status(201).json(product);
  } catch (err) {
    console.error("Error in /debug/create-test-product:", err.response?.data || err.message);
    if (err.response) {
      return res
        .status(500)
        .json({ error: "WooCommerce error", details: err.response.data });
    }
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Simple JSON product creation
app.post("/products", async (req, res) => {
  try {
    const { name, price, quantity } = req.body;

    if (!name || !price) {
      return res.status(400).json({ error: "name and price are required" });
    }

    const product = await createProduct({
      name,
      price,
      quantity: quantity ? Number(quantity) : 1,
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("Error in /products:", err.response?.data || err.message);
    if (err.response) {
      return res
        .status(500)
        .json({ error: "WooCommerce error", details: err.response.data });
    }
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Combined: upload images + create Woo product
app.post(
  "/new-item",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "tag", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files || {};
      const { name, price, quantity } = req.body;

      if (!name || !price) {
        return res.status(400).json({ error: "name and price are required" });
      }

      const product = await createProduct({
        name,
        price,
        quantity: quantity ? Number(quantity) : 1,
      });

      const savedFiles = {
        front: files.front ? files.front[0].filename : null,
        back: files.back ? files.back[0].filename : null,
        tag: files.tag ? files.tag[0].filename : null,
      };

      return res.status(201).json({
        product,
        images: savedFiles,
      });
    } catch (err) {
      console.error("Error in /new-item:", err.response?.data || err.message);
      if (err.response) {
        return res
          .status(500)
          .json({ error: "WooCommerce error", details: err.response.data });
      }
      res.status(500).json({ error: "Server error", details: err.message });
    }
  }
);

// Generate 2 on-model + 2 ghost images
app.post("/generate-images", async (req, res) => {
  try {
    const { frontFilename, backFilename } = req.body;

    if (!frontFilename || !backFilename) {
      return res
        .status(400)
        .json({ error: "frontFilename and backFilename are required" });
    }

    console.log("Generating images for:", { frontFilename, backFilename });

    const images = await generateOnModelAndGhost({
      frontFilename,
      backFilename,
    });

    return res.status(200).json(images);
  } catch (err) {
    console.error("Error in /generate-images:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to generate images",
      details: err.response?.data || err.message,
    });
  }
});

// Generate product copy (LLM)
app.post("/generate-copy", async (req, res) => {
  try {
    const { tagText, brand, productType, styleNotes } = req.body || {};

    if (!tagText && !productType) {
      return res.status(400).json({
        error: "Provide at least tagText or productType",
      });
    }

    const copy = await generateProductCopy({
      tagText,
      brand,
      productType,
      styleNotes,
    });

    return res.status(200).json(copy);
  } catch (err) {
    console.error("Error in /generate-copy:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to generate product copy",
      details: err.response?.data || err.message,
    });
  }
});

// Analyze a saved tag image by filename (after /new-item)
app.post("/analyze-tag", async (req, res) => {
  try {
    const { tagFilename } = req.body || {};

    if (!tagFilename) {
      return res
        .status(400)
        .json({ error: "tagFilename is required (saved tag image name)" });
    }

    console.log("Analyzing tag image with OCR (by filename):", tagFilename);

    const result = await extractTagText({ tagFilename });
    const parsed = parseTagMetadata(result.rawText || "");

    return res.status(200).json({
      ...result,
      parsed,
    });
  } catch (err) {
    console.error("Error in /analyze-tag:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to analyze tag image",
      details: err.response?.data || err.message,
    });
  }
});

// Analyze an uploaded tag image directly (no product creation needed)
app.post(
  "/analyze-tag-upload",
  upload.single("tag"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "tag file is required" });
      }

      const tagFilename = req.file.filename;
      console.log("Uploaded tag image for OCR:", tagFilename);

      const result = await extractTagText({ tagFilename });
      const parsed = parseTagMetadata(result.rawText || "");

      return res.status(200).json({
        tagFilename,
        ...result,
        parsed,
      });
    } catch (err) {
      console.error(
        "Error in /analyze-tag-upload:",
        err.response?.data || err.message
      );
      res.status(500).json({
        error: "Failed to analyze uploaded tag image",
        details: err.response?.data || err.message,
      });
    }
  }
);

// Start server
app.listen(port, () => {
  console.log(`auto-pop backend listening on http://localhost:${port}`);
});