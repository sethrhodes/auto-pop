// backend/index.js
const express = require("express");
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const cors = require("cors");

const { createTestProduct, createProduct } = require("./wooClient");
const { generateOnModelAndGhost } = require("./imageGenClient");
const { generateProductCopy } = require("./copyClient");
const { extractTagText } = require("./ocrClient");
const { parseTagMetadata } = require("./tagParser");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads (for frontend preview)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || "";
    const base = path.basename(file.originalname, ext); // Safer basename
    const ts = Date.now();
    cb(null, `${ts}-${base}${ext}`);
  },
});

const upload = multer({ storage });

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * 1. DRAFT ENDPOINT
 * Uploads images, runs OCR, generates initial Copy.
 * Does NOT create product in WooCommerce yet.
 */
app.post(
  "/api/draft",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "tag", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files || {};
      const tagFile = files.tag ? files.tag[0] : null;
      const frontFile = files.front ? files.front[0] : null;
      const backFile = files.back ? files.back[0] : null;

      const savedImages = {
        front: frontFile ? frontFile.filename : null,
        back: backFile ? backFile.filename : null,
        tag: tagFile ? tagFile.filename : null,
      };

      // 1. Analyze Tag (OCR)
      let tagText = "";
      let parsedMetadata = {};

      if (tagFile) {
        console.log("Analyzing tag:", tagFile.filename);
        try {
          const ocrResult = await extractTagText({ tagFilename: tagFile.filename });
          tagText = ocrResult.rawText;
          parsedMetadata = parseTagMetadata(tagText);
        } catch (ocrErr) {
          console.error("OCR failed (continuing):", ocrErr.message);
        }
      }

      // 2. Generate Copy (LLM)
      // Use parsed metadata or defaults
      let copy = {};
      try {
        copy = await generateProductCopy({
          tagText,
          brand: parsedMetadata.brand || "",
          productType: "", // could infer, or let user set later
          styleNotes: "",
        });
      } catch (copyErr) {
        console.error("Copy generation failed (continuing):", copyErr.message);
      }

      // Return draft object
      return res.json({
        images: savedImages,
        analysis: {
          tagText,
          detected: parsedMetadata,
          copy,
        },
      });

    } catch (err) {
      console.error("Error in /api/draft:", err.message);
      res.status(500).json({ error: "Draft creation failed", details: err.message });
    }
  }
);

/**
 * 2. IMAGE GENERATION ENDPOINT
 * Triggers Claid AI (or mock)
 */
app.post("/api/generate-images", async (req, res) => {
  try {
    const { frontFilename, backFilename, gender } = req.body;

    if (!frontFilename || !backFilename) {
      return res.status(400).json({ error: "frontFilename and backFilename required" });
    }

    // Call existing client
    const images = await generateOnModelAndGhost({
      frontFilename,
      backFilename,
      gender
    });

    res.json(images);

  } catch (err) {
    console.error("Error in /api/generate-images:", err.message);
    res.status(500).json({ error: "Image generation failed", details: err.message });
  }
});

/**
 * 3. PUBLISH ENDPOINT
 * Takes final data and creates WooCommerce product.
 */
app.post("/api/publish", async (req, res) => {
  try {
    const { product } = req.body;
    // Expecting product to have: { name, price, description, short_description, quantity, ... }

    if (!product || !product.name || !product.price) {
      return res.status(400).json({ error: "Product name and price are required" });
    }

    console.log("Publishing product:", product.name);

    const wooProduct = await createProduct({
      name: product.name,
      price: product.price,
      quantity: product.quantity || 1,
      // Pass other fields if createProduct supports them (we might need to update wooClient too)
    });

    // TODO: Update wooClient to accept description if needed, 
    // for now createProduct only takes basic args, assuming we might need to patch it 
    // or just rely on the basics for this iteration. 
    // Actually, let's just use what we have, or update it shortly.

    res.json({ success: true, product: wooProduct });

  } catch (err) {
    console.error("Error in /api/publish:", err.message);
    res.status(500).json({ error: "Publish failed", details: err.message });
  }
});

// START SERVER
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});