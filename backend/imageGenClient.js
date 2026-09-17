// backend/imageGenClient.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");
const { extractText } = require("./ocrClient");
require("dotenv").config();

const IMAGE_API_URL =
  process.env.IMAGE_API_URL || "https://api.claid.ai/v1/image/ai-fashion-models";

// Helper to sleep
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Smart Pre-processing:
 * Pixelate edges (low file size) but keep center SHARP (for text clarity).
 */
async function preprocessImage(filePath) {
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    // 1. Resize to optimal AI resolution (2500px)
    // 4000px is too large and gets downscaled poorly by models. 2500px is the sweet spot.
    if (metadata.width > 2500 || metadata.height > 2500) {
      await image.resize({ width: 2500, height: 2500, fit: 'inside' });
    }

    // 2. Global Enhancement (Contrast + Sharpen)
    // No pixelation tricks. Just clean, high-contrast, sharp input.
    const outputPath = path.join(path.dirname(filePath), `processed_${path.basename(filePath)}`);

    await image
      .modulate({ brightness: 1.05, saturation: 1.1 }) // Slight boost to separate text from background
      .sharpen({ sigma: 1.0, m1: 0.5, y2: 10, x1: 2 }) // Gentle global sharpen to define edges
      .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' }) // Max quality, no color subsampling (crucial for red/blue text)
      .toFile(outputPath);

    console.log("Global Enhance V3 complete:", outputPath);
    return outputPath;

  } catch (err) {
    console.error("Enhancement failed, using original:", err.message);
    return filePath;
  }
}

/**
 * Upload a local file to Claid to get a temporary public URL.
 * We use a minimal "resize" op or similar to trigger the upload flow.
 */
async function uploadToClaid(filePath, apiKey) {
  // Pre-process local file (Pixelate edges, keep center sharp)
  const processedPath = await preprocessImage(filePath);

  const form = new FormData();
  form.append("file", fs.createReadStream(processedPath));
  // Minimal config to just get the file uploaded and returned
  form.append(
    "data",
    JSON.stringify({
      operations: {
        // Relaxed limits to allow high-res center
        resizing: { width: 2500, height: 2500, fit: "bounds" },
        background: { remove: true },
      },
    })
  );

  // Use upload endpoint for multipart/form-data
  const uploadUrl = "https://api.claid.ai/v1/image/edit/upload";

  console.log("Uploading to Claid:", filePath);

  const res = await axios.post(uploadUrl, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${apiKey}`,
    },
    validateStatus: () => true, // Don't throw on error status
  });

  if (res.status >= 400) {
    console.error("Claid Upload Error:", JSON.stringify(res.data, null, 2));
    throw new Error(`Claid Upload Failed: ${res.status} ${res.statusText}`);
  }

  const tmpUrl = res.data?.data?.output?.tmp_url;
  if (!tmpUrl) {
    throw new Error("Failed to get tmp_url from Claid upload");
  }

  console.log("Got temp URL:", tmpUrl);
  return tmpUrl;
}

/**
 * Helper to start a Claid generation task with retries for 429
 */
async function triggerClaidGeneration(taskId, imageUrl, pose, backgroundPrompt, aspectRatio = "3:4", apiKey, customBgUrl = null, modelUrl = null) {
  const payload = {
    input: {
      clothing: Array.isArray(imageUrl) ? imageUrl : [imageUrl]
    },
    options: {
      pose: pose,
      background: backgroundPrompt,
      aspect_ratio: aspectRatio
    },
  };

  // Pin a specific model (custom or library) for consistent shots across products.
  // Without this, Claid picks a random suitable model per generation.
  if (modelUrl) {
    payload.input.model = modelUrl;
    console.log(`[${taskId}] Using custom model image.`);
  }

  if (customBgUrl) {
    console.log(`[${taskId}] Note: Custom background image URL provided (${customBgUrl}) but API only supports text prompts. Using prompt: "${backgroundPrompt}"`);
    // We DO NOT overwrite 'background' with the URL, as it breaks generation (treats URL as text).
    // We rely on 'backgroundPrompt' which should be descriptive (e.g. "rugged beach...").
  }

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.log(`[${taskId}] Triggering Claid generation (attempt ${attempt + 1})...`);
      const res = await axios.post(IMAGE_API_URL, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      const task = res.data?.data;
      if (!task || !task.result_url) {
        throw new Error(`[${taskId}] Claid response missing result_url`);
      }
      return task;

    } catch (err) {
      if (err.response) {
        console.error(`[${taskId}] Claid API Error (${err.response.status}):`, JSON.stringify(err.response.data, null, 2));
      }

      if (err.response && err.response.status === 429) {
        console.warn(`[${taskId}] Rate limited (429). Retrying in 5s...`);
        await sleep(5000 * (attempt + 1)); // Backoff: 5s, 10s, 15s
        attempt++;
      } else {
        throw err; // Rethrow other errors
      }
    }
  }
  throw new Error(`[${taskId}] Failed after ${maxRetries} retries (Rate Limit)`);
}

/**
 * Poll a single Claid task until completion
 */
async function pollClaidTask(taskId, resultUrl, apiKey) {
  const maxAttempts = 20;
  const delayMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(delayMs);

    const res = await axios.get(resultUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const status = res.data?.data?.status;
    console.log(`[${taskId}] Poll attempt ${attempt}: ${status}`);

    if (status === "DONE") {
      const output = res.data?.data?.result?.output_objects?.[0];
      const url = output?.tmp_url || output?.claid_storage_uri;
      if (!url) throw new Error(`[${taskId}] DONE but no output URL`);
      return url;
    }

    if (status === "ERROR") {
      const errs = JSON.stringify(res.data?.data?.errors || []);
      throw new Error(`[${taskId}] Failed: ${errs}`);
    }
  }
  throw new Error(`[${taskId}] Timed out`);
}

/**
 * Helper to run a full generation cycle (Trigger + Poll)
 */
async function runGenerationTask(taskId, imageUrl, pose, backgroundPrompt, aspectRatio, apiKey, customBgUrl = null, modelUrl = null) {
  const task = await triggerClaidGeneration(taskId, imageUrl, pose, backgroundPrompt, aspectRatio, apiKey, customBgUrl, modelUrl);
  const url = await pollClaidTask(taskId, task.result_url, apiKey);
  return url;
}

/**
 * Find and upload a model image from the user's model pool, if provided.
 *
 * Pool files live in uploads/ and rotate across products:
 *   custom_model_men.jpg, custom_model_men_2.jpg, ...   (men's pool)
 *   custom_model_women.jpg, custom_model_women_2.jpg, ... (women's pool)
 *   custom_model.jpg, custom_model_2.jpg, ...            (fallback pool)
 *
 * The pick is deterministic per product (seeded by the product's photo
 * filename) so front/back/lifestyle shots AND later regenerations of the
 * same product always land on the same model, while different products
 * rotate through the pool. Returns a Claid temp URL, or null if no pool.
 */
/**
 * Claid inherits composition from the reference image in input.model, so a
 * full-body model photo drags shots 1 and 2 wide no matter what the pose text
 * asks for. Cache a waist-up crop (top 55%) and feed that for the close shots,
 * keeping the full-body original for the lifestyle shot.
 */
async function upperBodyCrop(srcPath) {
  const dir = path.join(path.dirname(srcPath), ".model_crops");
  const out = path.join(dir, path.basename(srcPath, path.extname(srcPath)) + "_upper.jpg");
  try {
    const src = fs.statSync(srcPath);
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= src.mtimeMs) return out; // cached
  } catch {}
  fs.mkdirSync(dir, { recursive: true });
  const meta = await sharp(srcPath).metadata();
  const height = Math.max(1, Math.round(meta.height * 0.55));
  await sharp(srcPath).extract({ left: 0, top: 0, width: meta.width, height }).jpeg({ quality: 92 }).toFile(out);
  console.log(`Cropped model reference to upper body: ${path.basename(out)} (${meta.width}x${height})`);
  return out;
}

async function getCustomModelUrl(gender, apiKey, seed = "", framing = "full") {
  // Normalize UI gender values ('womens' -> 'women', 'mens' -> 'men') to pool filenames
  gender = String(gender || "").toLowerCase().replace(/^womens$/, "women").replace(/^mens$/, "men");
  const uploads = path.join(__dirname, "uploads");
  const poolFor = (prefix) =>
    fs.readdirSync(uploads)
      .filter(f => new RegExp(`^${prefix}(_\\d+)?\\.(jpe?g|png)$`, "i").test(f))
      .sort();

  let pool = poolFor(`custom_model_${gender}`);
  if (pool.length === 0) pool = poolFor("custom_model");
  if (pool.length === 0) return null;

  // Simple stable hash of the seed → index into the pool
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const chosen = pool[hash % pool.length];

  console.log(`Model pool (${pool.length} ${gender || "any"}): picked ${chosen} [${framing}]`);
  try {
    let modelPath = path.join(uploads, chosen);
    if (framing === "upper") modelPath = await upperBodyCrop(modelPath);
    return await uploadToClaid(modelPath, apiKey);
  } catch (e) {
    console.error(`Failed to upload model image ${chosen}:`, e.message);
    return null;
  }
}



/**
 * Identity lock for shots where the model's face is visible.
 *
 * The real anchor is input.model (the pinned pool photo) — this is prompt
 * reinforcement on top of it, not a substitute. Deliberately NOT applied to
 * back views ("no face visible") or to bottoms shots (waist-down / walking
 * away), where it would contradict the framing.
 */
const FACE_PRESERVE =
  "exact same face as the reference model, identical facial features and skin tone, do not alter replace or beautify the face, preserve model identity";

/**
 * Jeans the model wears in generated shots, by gender.
 * Only used for tops — for a "bottom" product the garment IS the pants.
 */
function jeansTermFor(gender) {
  const g = String(gender || "").toLowerCase();
  if (g === "men" || g === "mens") return "loose-fitting relaxed blue jeans";
  if (g === "women" || g === "womens") return "regular-fit straight-leg blue jeans, not tight or skinny";
  return "blue jeans";
}

async function generateOnModelAndGhost({ frontFilename, backFilename, logoFilename = null, gender = "female", category = "top", isHooded = true, apiKeys = {} }) {
  const apiKey = apiKeys.IMAGE_API_KEY || process.env.IMAGE_API_KEY;
  if (!apiKey) {
    throw new Error("IMAGE_API_KEY missing (Check Settings or .env)");
  }

  const frontPath = path.join(__dirname, "uploads", frontFilename);
  const backPath = path.join(__dirname, "uploads", backFilename);

  if (!fs.existsSync(frontPath)) throw new Error(`Front not found: ${frontPath}`);
  if (!fs.existsSync(backPath)) throw new Error(`Back not found: ${backPath}`);

  const [frontUrl, backUrl] = await Promise.all([
    uploadToClaid(frontPath, apiKey),
    uploadToClaid(backPath, apiKey),
  ]);

  let logoUrl = null;
  if (logoFilename) {
    const logoPath = path.join(__dirname, "uploads", logoFilename);
    if (fs.existsSync(logoPath)) {
      console.log("Uploading logo file for fidelity...");
      logoUrl = await uploadToClaid(logoPath, apiKey);
    }
  }

  // Determine model terms
  let modelTerm = "female model";
  if (gender === "men") {
    modelTerm = "male model";
  } else if (gender === "kids") {
    modelTerm = "child model";
  } else if (gender === "womens" || gender === "women") {
    modelTerm = "female model";
  } else if (gender === "unisex") {
    modelTerm = "model"; // Neutral term
  }

  // Parallel: Upload AND OCR (if logo exists)
  let logoText = "";
  if (logoFilename) {
    const logoPath = path.join(__dirname, "uploads", logoFilename);
    if (fs.existsSync(logoPath)) {
      try {
        console.log("Running OCR on logo...");
        const ocrRes = await extractText({ filename: logoFilename, apiKeys });
        if (ocrRes && ocrRes.rawText) {
          // simple cleanup
          logoText = ocrRes.rawText.replace(/\s+/g, " ").trim().slice(0, 50);
          console.log("Extracted Logo Text:", logoText);
        }
      } catch (e) {
        console.error("OCR Check Failed:", e.message);
      }
    }
  }

  // --- PROMPT LOGIC ---
  const isBottom = category === "bottom";

  // Helper for text injection
  const textPrompt = logoText ? `, shirt design features text "${logoText}" written clearly` : "";

  const jeansTerm = jeansTermFor(gender);

  // Define Prompt Templates
  const getTopPrompts = (view, hoodState) => {
    if (!isHooded) {
      // Non-Hooded (T-Shirt / Crewneck)
      if (view === 'front') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, entire head and face fully in frame, cropped at the waist, no legs visible, focus on shirt${textPrompt}, crew neck, front view, wearing ${jeansTerm}, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, back of the head fully in frame, cropped at the waist, no legs visible, strictly rear view photographed from directly behind, model facing completely away from camera with back to the viewer, back of the shirt fully visible, back of the head visible, face and front of body must NOT be visible, wearing ${jeansTerm}, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, full body shot from head to feet, entire body including shoes fully in frame, casual street style, wearing the shirt with ${jeansTerm}, flip-flops on feet${textPrompt}, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
    } else {
      // Hooded (Default)
      if (view === 'front') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, entire head and face fully in frame, cropped at the waist, no legs visible, focus on hoodie${textPrompt}, hood fully down hanging behind neck and shoulders, absolutely NOT on head, head hair and face fully visible, front view, no t-shirt or undershirt layered under the hoodie, wearing ${jeansTerm}, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, back of the head fully in frame, cropped at the waist, no legs visible, strictly rear view photographed from directly behind, model facing completely away from camera with back to the viewer, back of the hoodie fully visible, hood up on head, face and front of body must NOT be visible, no t-shirt layered under the hoodie, wearing ${jeansTerm}, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, full body shot from head to feet, entire body including shoes fully in frame, wearing the hoodie over ${jeansTerm}, no t-shirt layered underneath, flip-flops on feet${textPrompt}, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
    }
  };

  // Shot 1 Prompts (Pose Only)
  const shot1Prompt = isBottom
    ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, front view, wearing the clothing with a plain white t-shirt on top, no upper body focus`
    : getTopPrompts('front');

  // Shot 2 Prompts (Pose Only)
  const shot2Prompt = isBottom
    ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, back view, wearing the clothing with a plain white t-shirt on top, no upper body focus`
    : getTopPrompts('back');

  // Shot 3 Prompts (Lifestyle Pose)
  const shot3Prompt = isBottom
    ? `lifestyle photography of single ${modelTerm} walking away, full body shot from head to feet, entire body including shoes fully in frame, focus on pants/shorts, wearing the clothing with a plain white t-shirt on top, flip-flops on feet`
    : getTopPrompts('lifestyle');

  // Backgrounds
  // User requested "light grey" specifically.
  const STANDARD_BG = "light grey seamless studio backdrop, hex color #E4E4E4, evenly lit, soft shadows";
  const BEACH_BG = "rugged northern california beach on a sunny day, bright natural lighting, blue sky, cliffs in background, cinematic";

  // Check for Custom Background File
  let customBgUrl = null;
  const customBgPath = path.join(__dirname, "uploads", "custom_beach_bg.jpg");
  if (fs.existsSync(customBgPath)) {
    console.log("Found custom background image, uploading...");
    try {
      customBgUrl = await uploadToClaid(customBgPath, apiKey);
    } catch (e) {
      console.error("Failed to upload custom BG:", e.message);
    }
  }

  // Prepare Inputs
  // NOTE: We do NOT send logoUrl to Claid as a second garment, as it causes generation failures.
  // We only use the logo for OCR (text extraction) to improve the prompt.
  const frontInput = frontUrl;
  const backInput = backUrl;

  // Model pool: rotates across products, stays consistent within one (seeded by
  // front image). Same pool pick, two framings — see upperBodyCrop().
  const [modelUrlUpper, modelUrlFull] = await Promise.all([
    getCustomModelUrl(gender, apiKey, frontFilename, "upper"),
    getCustomModelUrl(gender, apiKey, frontFilename, "full"),
  ]);

  // 2. Trigger PARALLEL Model Generations (3 Shots)
  console.log("Starting parallel generation for 3 shots...");

  const results = await Promise.allSettled([
    // Shot 1: Front
    runGenerationTask("SHOT_1", frontInput, shot1Prompt, STANDARD_BG, "3:4", apiKey, null, modelUrlUpper),

    // Shot 2: Back
    runGenerationTask("SHOT_2", backInput, shot2Prompt, STANDARD_BG, "3:4", apiKey, null, modelUrlUpper),

    // Shot 3: Lifestyle
    runGenerationTask("SHOT_3", frontInput, shot3Prompt, BEACH_BG, "3:4", apiKey, customBgUrl, modelUrlFull)
  ]);

  // Helper to safely get URL or null
  const getResultUrl = (result, label) => {
    if (result.status === 'fulfilled') return result.value;
    console.error(`[${label}] Generation Failed:`, result.reason);
    return null; // Frontend should handle null (or show error placeholder)
  };

  const url1 = getResultUrl(results[0], "SHOT_1");
  const url2 = getResultUrl(results[1], "SHOT_2");
  const url3 = getResultUrl(results[2], "SHOT_3");

  // If ALL failed, then throw error to frontend
  if (!url1 && !url2 && !url3) {
    const errorMessages = results.map(r => r.reason?.message).join("; ");
    throw new Error(`All image generations failed: ${errorMessages}`);
  }

  return {
    gallery: [
      { label: "Front Detail", url: url1 || "https://placehold.co/600x800?text=Generation+Failed" },
      { label: "Back Detail", url: url2 || "https://placehold.co/600x800?text=Generation+Failed" },
      { label: "Beach Lifestyle", url: url3 || "https://placehold.co/600x800?text=Generation+Failed" }
    ]
  };
}

const SHOT_ASPECT_RATIO = "3:4";



async function generateSingleShot({ frontFilename, backFilename, gender = "female", shotIndex, category = "top", isHooded = true, apiKeys = {} }) {
  const apiKey = apiKeys.IMAGE_API_KEY || process.env.IMAGE_API_KEY;
  if (!apiKey) throw new Error("IMAGE_API_KEY missing");

  const frontPath = path.join(__dirname, "uploads", frontFilename);
  const backPath = path.join(__dirname, "uploads", backFilename);

  if (!fs.existsSync(frontPath)) throw new Error(`Front not found: ${frontPath}`);
  if (!fs.existsSync(backPath)) throw new Error(`Back not found: ${backPath}`);

  const [frontUrl, backUrl] = await Promise.all([
    uploadToClaid(frontPath, apiKey),
    uploadToClaid(backPath, apiKey),
  ]);

  let modelTerm = "female model";
  if (gender === "men") {
    modelTerm = "male model";
  } else if (gender === "kids") {
    modelTerm = "child model";
  } else if (gender === "womens" || gender === "women") {
    modelTerm = "female model";
  } else if (gender === "unisex") {
    modelTerm = "model";
  }

  // --- PROMPT LOGIC ---
  const isBottom = category === "bottom";

  const jeansTerm = jeansTermFor(gender);

  // Re-define helper inside scope (or could move out)
  const getTopPrompts = (view) => {
    if (!isHooded) {
      if (view === 'front') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, entire head and face fully in frame, cropped at the waist, no legs visible, focus on shirt, crew neck, front view, wearing ${jeansTerm}, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, back of the head fully in frame, cropped at the waist, no legs visible, strictly rear view photographed from directly behind, model facing completely away from camera with back to the viewer, back of the shirt fully visible, back of the head visible, face and front of body must NOT be visible, wearing ${jeansTerm}, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, full body shot from head to feet, entire body including shoes fully in frame, casual street style, wearing the shirt with ${jeansTerm}, flip-flops on feet, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
    } else {
      if (view === 'front') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, entire head and face fully in frame, cropped at the waist, no legs visible, focus on hoodie, hood fully down hanging behind neck and shoulders, absolutely NOT on head, head hair and face fully visible, front view, no t-shirt or undershirt layered under the hoodie, wearing ${jeansTerm}, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, medium shot framed from the waist to the top of the head, back of the head fully in frame, cropped at the waist, no legs visible, strictly rear view photographed from directly behind, model facing completely away from camera with back to the viewer, back of the hoodie fully visible, hood up on head, face and front of body must NOT be visible, no t-shirt layered under the hoodie, wearing ${jeansTerm}, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, full body shot from head to feet, entire body including shoes fully in frame, wearing the hoodie over ${jeansTerm}, no t-shirt layered underneath, flip-flops on feet, ${FACE_PRESERVE}, preserve clothing details, sharp text, high fidelity texture`;
    }
  };

  let task, taskId;
  const STANDARD_BG = "light grey seamless studio backdrop, hex color #E4E4E4, evenly lit, soft shadows";
  const BEACH_BG = "rugged northern california beach on a sunny day, bright natural lighting, blue sky, cliffs in background, cinematic";

  // Check for Custom Background File
  let customBgUrl = null;
  const customBgPath = path.join(__dirname, "uploads", "custom_beach_bg.jpg");
  if (shotIndex === 2 && fs.existsSync(customBgPath)) {
    console.log("Found custom background image for regen, uploading...");
    try {
      customBgUrl = await uploadToClaid(customBgPath, apiKey);
    } catch (e) {
      console.error("Failed to upload custom BG:", e.message);
    }
  }

  // Same seed as the original generation → regens land on the same model.
  // Shots 0/1 are close-ups, shot 2 is full body — match the reference framing.
  const modelUrl = await getCustomModelUrl(
    gender, apiKey, frontFilename, shotIndex === 2 ? "full" : "upper"
  );

  if (shotIndex === 0) {
    // Shot 1: Front
    taskId = "REGEN_SHOT_1";
    const prompt = isBottom
      ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, front view, wearing the clothing with a plain white t-shirt on top, no upper body focus`
      : getTopPrompts('front');

    task = await triggerClaidGeneration(taskId, frontUrl, prompt, STANDARD_BG, SHOT_ASPECT_RATIO, apiKey, null, modelUrl);

  } else if (shotIndex === 1) {
    // Shot 2: Back
    taskId = "REGEN_SHOT_2";
    const prompt = isBottom
      ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, back view, wearing the clothing with a plain white t-shirt on top, no upper body focus`
      : getTopPrompts('back');

    task = await triggerClaidGeneration(taskId, backUrl, prompt, STANDARD_BG, SHOT_ASPECT_RATIO, apiKey, null, modelUrl);

  } else if (shotIndex === 2) {
    // Shot 3: Lifestyle
    taskId = "REGEN_SHOT_3";
    const prompt = isBottom
      ? `lifestyle photography of single ${modelTerm} walking away, full body shot from head to feet, entire body including shoes fully in frame, focus on pants/shorts, wearing the clothing with a plain white t-shirt on top, flip-flops on feet`
      : getTopPrompts('lifestyle');

    task = await triggerClaidGeneration(taskId, frontUrl, prompt, BEACH_BG, SHOT_ASPECT_RATIO, apiKey, customBgUrl, modelUrl);
  } else {
    throw new Error("Invalid shotIndex (0-2)");
  }

  const url = await pollClaidTask(taskId, task.result_url, apiKey);
  return { url, shotIndex };
}

module.exports = {
  generateOnModelAndGhost,
  generateSingleShot,
  // Exposed for scripts/abTest.js (provider comparison harness)
  uploadToClaid,
  runGenerationTask,
  preprocessImage
};