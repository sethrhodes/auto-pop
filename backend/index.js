// backend/index.js
const express = require("express");
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const cors = require("cors");

const { createTestProduct, createProduct, updateProduct } = require("./wooClient");
const { generateOnModelAndGhost } = require("./imageGenClient");
const { generateProductCopy } = require("./copyClient");
const { extractTagText } = require("./ocrClient");
const { parseTagMetadata } = require("./tagParser");
const { initDB, Product } = require('./database');
const { authenticateToken, loadUserKeys, register, login, getSettings, updateSettings } = require("./auth");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads (for frontend preview)
// Serve static files from uploads (for frontend preview)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// SERVE FRONTEND (Production)
app.use(express.static(path.join(__dirname, "../frontend/dist")));

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

// --- AUTH ROUTES ---
app.post("/api/auth/register", register);
app.post("/api/auth/login", login);

// --- SETTINGS ROUTES (Protected) ---
app.get("/api/settings", authenticateToken, getSettings);
app.post("/api/settings", authenticateToken, updateSettings);


/**
 * 1. DRAFT ENDPOINT
 * Uploads images, runs OCR, generates initial Copy.
 * Does NOT create product in WooCommerce yet.
 */
app.post(
  "/api/draft",
  authenticateToken, loadUserKeys, // Protected
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
          // OCR Client uses OCR_API_KEY. Need to update it too? 
          // For now assuming system OCR key, or pass req.userKeys if users own OCR keys.
          // Let's pass keys to be safe, even if OCR is shared.
          const ocrResult = await extractTagText({
            tagFilename: tagFile.filename,
            apiKeys: req.userKeys
          });
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
          apiKeys: req.userKeys // PASS DYNAMIC KEYS
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
app.post("/api/generate-images", authenticateToken, loadUserKeys, async (req, res) => {
  try {
    const { frontFilename, backFilename, gender, category } = req.body;

    if (!frontFilename || !backFilename) {
      return res.status(400).json({ error: "frontFilename and backFilename required" });
    }

    // Call existing client
    const images = await generateOnModelAndGhost({
      frontFilename,
      backFilename,
      gender,
      category,
      apiKeys: req.userKeys // PASS DYNAMIC KEYS
    });

    res.json(images);

  } catch (err) {
    console.error("Error in /api/generate-images:", err.message);
    res.status(500).json({ error: "Image generation failed", details: err.message });
  }
});

app.post("/api/regenerate-image", authenticateToken, loadUserKeys, async (req, res) => {
  try {
    const { frontFilename, backFilename, gender, category, shotIndex } = req.body;
    console.log(`[REGEN] Request: front=${frontFilename}, back=${backFilename}, index=${shotIndex}`); // DEBUG

    if (shotIndex === undefined) return res.status(400).json({ error: "shotIndex required" });

    const result = await require("./imageGenClient").generateSingleShot({
      frontFilename,
      backFilename,
      gender,
      shotIndex,
      category,
      apiKeys: req.userKeys
    });
    res.json(result);
  } catch (err) {
    console.error("Error in /api/regenerate-image:", err.message);
    res.status(500).json({ error: "Regeneration failed", details: err.message });
  }
});

/**
 * GET /api/products
 * List all products for the current user
 */
app.get("/api/products", authenticateToken, async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { user_id: req.user.id },
      order: [['createdAt', 'DESC']]
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/products
 * Save a product draft (Local DB only)
 */
app.post("/api/products", authenticateToken, async (req, res) => {
  try {
    const { product } = req.body;
    console.log("Saving product payload:", JSON.stringify(product, null, 2)); // DEBUG
    if (!product || !product.name) {
      return res.status(400).json({ error: "Product name required" });
    }

    const mainImage = (product.gallery && product.gallery.length > 0) ? product.gallery[0].url : null;

    let savedProduct;
    if (product.id) {
      // Try to find and update
      const existing = await Product.findOne({ where: { id: product.id, user_id: req.user.id } });
      if (existing) {
        await existing.update({
          name: product.name,
          sku: product.sku,
          price: product.price,
          description: product.description,
          short_description: product.short_description,
          gallery: JSON.stringify(product.gallery || []),
          image_url: mainImage,
          status: 'draft',
          variants: product.variants ? JSON.stringify(product.variants) : null,
          front_image: product.front_image,
          back_image: product.back_image
        });
        savedProduct = existing;
      }
    }

    if (!savedProduct) {
      savedProduct = await Product.create({
        user_id: req.user.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        description: product.description,
        short_description: product.short_description,
        gallery: JSON.stringify(product.gallery || []),
        status: 'draft',
        image_url: mainImage,
        remote_id: null,
        variants: product.variants ? JSON.stringify(product.variants) : null,
        front_image: product.front_image,
        back_image: product.back_image
      });
    }

    res.json(savedProduct);
  } catch (err) {
    console.error("Error saving draft:", err);
    res.status(500).json({ error: "Failed to save draft" });
  }
});

/**
 * DELETE /api/products/:id
 * Delete a product/draft
 */
app.delete("/api/products/:id", authenticateToken, async (req, res) => {
  try {
    const deleted = await Product.destroy({
      where: { id: req.params.id, user_id: req.user.id }
    });
    if (!deleted) return res.status(404).json({ error: "Product not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/products/:id
 * Get a specific product (for editing)
 */
app.get("/api/products/:id", authenticateToken, async (req, res) => {
  try {
    const product = await Product.findOne({
      where: { id: req.params.id, user_id: req.user.id }
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    console.log(`[GET] Product ${product.id} loaded. Images: Front=${product.front_image}, Back=${product.back_image}`); // DEBUG

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3. PUBLISH ENDPOINT
 * Takes final data, creates Woo product, AND saves to local History.
 */
app.post("/api/publish", authenticateToken, loadUserKeys, async (req, res) => {
  try {
    const { product } = req.body;
    // Expecting product to have: { name, price, description, short_description, quantity, gallery: [{url, ...}] }

    if (!product || !product.name || !product.price) {
      return res.status(400).json({ error: "Product name and price are required" });
    }

    console.log("Publishing product:", product.name);

    // Format images for WooCommerce: [{ src: 'url' }, ...]
    const wooImages = (product.gallery || []).map(img => ({
      src: img.url
    }));

    let wooProduct;
    let localProduct;

    // Check if we should UPDATE or CREATE
    if (product.id) {
      localProduct = await Product.findOne({ where: { id: product.id, user_id: req.user.id } });
    }

    if (localProduct && localProduct.remote_id) {
      // UPDATE Existing Woo Product
      console.log(`Updating existing Woo Product ${localProduct.remote_id}...`);
      wooProduct = await updateProduct(localProduct.remote_id, {
        name: product.name,
        price: product.price,
        sku: product.sku,
        quantity: product.quantity || 1,
        description: product.description,
        short_description: product.short_description,
        images: wooImages
      }, req.userKeys);
    } else {
      // CREATE New Woo Product
      wooProduct = await createProduct({
        name: product.name,
        price: product.price,
        sku: product.sku,
        quantity: product.quantity || 1,
        description: product.description,
        short_description: product.short_description,
        images: wooImages,
        apiKeys: req.userKeys
      });
    }

    // Save/Update to Local DB History
    const mainImage = wooImages.length > 0 ? wooImages[0].src : null;

    if (localProduct) {
      await localProduct.update({
        name: product.name,
        sku: product.sku,
        price: product.price,
        status: 'published',
        image_url: mainImage,
        remote_id: wooProduct.id.toString()
      });
    } else {
      await Product.create({
        user_id: req.user.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        status: 'published',
        image_url: mainImage,
        remote_id: wooProduct.id.toString()
      });
    }

    res.json({ success: true, product: wooProduct });

  } catch (err) {
    if (err.response) {
      console.error("WooCommerce Error:", JSON.stringify(err.response.data, null, 2));
      // Send the Woo error details to the frontend
      return res.status(500).json({ error: "Publish failed", details: JSON.stringify(err.response.data) });
    }
    console.error("Error in /api/publish:", err.message);
    res.status(500).json({ error: "Publish failed", details: err.message });
  }
});

// SPA Catch-all (for React Router)
// Note: using regex due to Express 5 syntax change regarding '*'
app.get(/(.*)/, (req, res) => {
  const indexPath = path.join(__dirname, "../frontend/dist", "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Frontend build not found. Please run 'npm run build' in the frontend directory.");
  }
});

// START SERVER
app.listen(port, '0.0.0.0', async () => {
  await initDB(); // Init DB on Start
  console.log(`Backend listening on http://0.0.0.0:${port}`);

  // Start Inventory Sync
  const syncEngine = require('./syncEngine');
  syncEngine.startPolling(); // Note: Sync Engine currently uses system env. 
  // TODO: Update SyncEngine to handle multiple users? Or strict system user?
  // For now, SyncEngine remains system-level.
  console.log("RMS Inventory Sync Engine started.");
});

// WEBHOOK HANDLER
app.post("/api/webhook/order-created", async (req, res) => {
  // Webhooks from Woo don't have user tokens. Sync Engine must rely on System Creds?
  // Or we find the user based on API keys? 
  // For MVP: Sync Engine is "Admin/System" level using .env or a specific user.
  // We'll leave it as is for now.
  try {
    const syncEngine = require('./syncEngine');
    await syncEngine.handleWebOrderCreated(req.body);
    res.status(200).send("Webhook received");
  } catch (err) {
    console.error("Webhook Error:", err.message);
    res.status(500).send("Webhook processing failed");
  }
});