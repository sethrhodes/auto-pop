const express = require("express");
require("dotenv").config();
const path = require("path");
const multer = require("multer");
const { createTestProduct, createProduct } = require("./wooClient");
const { extractTextFromTag } = require("./ocrClient");
const { generateOnModelAndGhost } = require("./imageGenClient");

const app = express();
const port = process.env.PORT || 3000;

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: (req, file, cb) => {
    // Simple unique filename: timestamp-fieldname-original
    const uniqueSuffix = Date.now() + "-" + file.fieldname;
    const ext = file.originalname.split(".").pop();
    cb(null, `${uniqueSuffix}.${ext}`);
  },
});

const upload = multer({ storage });

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

// Upload route: expects fields front, back, tag
app.post(
  "/upload",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "tag", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      const files = req.files;
      const { quantity } = req.body; // optional extra field

      console.log("Uploaded files:", files);
      console.log("Quantity:", quantity);

      const response = {
        front: files.front ? files.front[0].filename : null,
        back: files.back ? files.back[0].filename : null,
        tag: files.tag ? files.tag[0].filename : null,
        quantity: quantity ? Number(quantity) : null,
      };

      res.status(200).json(response);
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

// Combined route: upload images + create product in WooCommerce
app.post(
  "/new-item",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "tag", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files;
      const { name, price, quantity } = req.body;

      if (!name || !price) {
        return res.status(400).json({ error: "name and price are required" });
      }

      // 1) Create Woo product
      const product = await createProduct({
        name,
        price,
        quantity: quantity ? Number(quantity) : 1,
      });

      // 2) Collect saved filenames for now (we'll later attach or send to AI)
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
      console.error("Error in /new-item:");
      if (err.response) {
        console.error(err.response.data);
        return res
          .status(500)
          .json({ error: "WooCommerce error", details: err.response.data });
      } else {
        console.error(err.message);
        return res.status(500).json({ error: "Server error", details: err.message });
      }
    }
  }
);

// Analyze a saved tag image by filename and return extracted text
app.post("/analyze-tag", async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: "filename is required" });
    }

    const text = await extractTextFromTag(filename);

    return res.status(200).json({
      filename,
      text,
    });
  } catch (err) {
    console.error("Error in /analyze-tag:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to analyze tag image",
      details: err.response?.data || err.message,
    });
  }
});

// Generate 2 on-model + 2 ghost images for a garment
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

app.listen(port, () => {
  console.log(`auto-pop backend listening on http://localhost:${port}`);
});