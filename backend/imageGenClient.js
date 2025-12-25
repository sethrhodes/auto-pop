// backend/imageGenClient.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const { extractText } = require("./ocrClient");
require("dotenv").config();

const IMAGE_API_URL =
  process.env.IMAGE_API_URL || "https://api.claid.ai/v1/image/ai-fashion-models";

// Helper to sleep
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a local file to Claid to get a temporary public URL.
 * We use a minimal "resize" op or similar to trigger the upload flow.
 */
async function uploadToClaid(filePath, apiKey) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  // Minimal config to just get the file uploaded and returned
  form.append(
    "data",
    JSON.stringify({
      operations: {
        // No-op or minimal op: re-encode to jpeg partial quality? 
        // Or just resize to same width? Let's just do a dummy logic via 'smart_height' or similar defaults.
        // Actually, Claid requires at least one op usually.
        // Let's rely on simple 'restoration' or just 'resize'.
        // "Ghost" improvements: Remove background + Center/Pad
        // "Ghost" improvements: Remove background + Standardize size
        resizing: { width: 1500, height: 2000, fit: "bounds" },
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
async function triggerClaidGeneration(taskId, imageUrl, pose, backgroundPrompt, aspectRatio = "3:4", apiKey, customBgUrl = null) {
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
async function runGenerationTask(taskId, imageUrl, pose, backgroundPrompt, aspectRatio, apiKey, customBgUrl = null) {
  const task = await triggerClaidGeneration(taskId, imageUrl, pose, backgroundPrompt, aspectRatio, apiKey, customBgUrl);
  const url = await pollClaidTask(taskId, task.result_url, apiKey);
  return url;
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
async function runGenerationTask(taskId, imageUrl, pose, backgroundPrompt, aspectRatio, apiKey, customBgUrl = null) {
  const task = await triggerClaidGeneration(taskId, imageUrl, pose, backgroundPrompt, aspectRatio, apiKey, customBgUrl);
  const url = await pollClaidTask(taskId, task.result_url, apiKey);
  return url;
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

  // Define Prompt Templates
  const getTopPrompts = (view, hoodState) => {
    if (!isHooded) {
      // Non-Hooded (T-Shirt / Crewneck)
      if (view === 'front') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on shirt${textPrompt}, crew neck, front view, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on shirt, back view, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, casual street style, wearing the shirt${textPrompt}, preserve clothing details, sharp text, high fidelity texture`;
    } else {
      // Hooded (Default)
      if (view === 'front') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie${textPrompt}, hood down resting on shoulders, NOT on head, front view, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood up on head, back view, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, looks like a surfer, messy hair, wearing the clothing${textPrompt}, preserve clothing details, sharp text, high fidelity texture`;
    }
  };

  // Shot 1 Prompts (Pose Only)
  const shot1Prompt = isBottom
    ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, front view, wearing the clothing, no upper body focus`
    : getTopPrompts('front');

  // Shot 2 Prompts (Pose Only)
  const shot2Prompt = isBottom
    ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, back view, wearing the clothing, no upper body focus`
    : getTopPrompts('back');

  // Shot 3 Prompts (Lifestyle Pose)
  const shot3Prompt = isBottom
    ? `lifestyle photography of single ${modelTerm} walking away, focus on pants/shorts, wearing the clothing`
    : getTopPrompts('lifestyle');

  // Backgrounds
  // User requested "light grey" specifically.
  const STANDARD_BG = "very light grey professional studio background, hex color #F5F5F5, soft shadows";
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

  // 2. Trigger PARALLEL Model Generations (3 Shots)
  console.log("Starting parallel generation for 3 shots...");

  const results = await Promise.allSettled([
    // Shot 1: Front
    runGenerationTask("SHOT_1", frontInput, shot1Prompt, STANDARD_BG, "3:4", apiKey),

    // Shot 2: Back
    runGenerationTask("SHOT_2", backInput, shot2Prompt, STANDARD_BG, "3:4", apiKey),

    // Shot 3: Lifestyle
    runGenerationTask("SHOT_3", frontInput, shot3Prompt, BEACH_BG, "3:4", apiKey, customBgUrl)
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

  // Re-define helper inside scope (or could move out)
  const getTopPrompts = (view) => {
    if (!isHooded) {
      if (view === 'front') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on shirt, crew neck, front view, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on shirt, back view, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, casual street style, wearing the shirt, preserve clothing details, sharp text, high fidelity texture`;
    } else {
      if (view === 'front') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood down resting on shoulders, NOT on head, front view, preserve clothing details, sharp text, high fidelity texture`;
      if (view === 'back') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood up on head, back view, preserve clothing details, high fidelity texture`;
      if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, looks like a surfer, messy hair, wearing the clothing, preserve clothing details, sharp text, high fidelity texture`;
    }
  };

  let task, taskId;
  const STANDARD_BG = "very light grey professional studio background, hex color #F5F5F5, soft shadows";
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

  if (shotIndex === 0) {
    // Shot 1: Front
    taskId = "REGEN_SHOT_1";
    const prompt = isBottom
      ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, front view, wearing the clothing, no upper body focus`
      : getTopPrompts('front');

    // Shot 2 Prompts (Pose Only)
    const shot2Prompt = isBottom
      ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, back view, wearing the clothing, no upper body focus`
      : getTopPrompts('back');

    // Shot 3 Prompts (Lifestyle Pose)
    const shot3Prompt = isBottom
      ? `lifestyle photography of single ${modelTerm} walking away, focus on pants/shorts, wearing the clothing`
      : getTopPrompts('lifestyle');

    // Backgrounds
    // User requested "light grey" specifically.
    const STANDARD_BG = "very light grey professional studio background, hex color #F5F5F5, soft shadows";
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

    // 2. Trigger PARALLEL Model Generations (3 Shots)
    console.log("Starting parallel generation for 3 shots...");

    const results = await Promise.allSettled([
      // Shot 1: Front
      runGenerationTask("SHOT_1", frontInput, shot1Prompt, STANDARD_BG, "3:4", apiKey),

      // Shot 2: Back
      runGenerationTask("SHOT_2", backInput, shot2Prompt, STANDARD_BG, "3:4", apiKey),

      // Shot 3: Lifestyle
      runGenerationTask("SHOT_3", frontInput, shot3Prompt, BEACH_BG, "3:4", apiKey, customBgUrl)
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

    // Re-define helper inside scope (or could move out)
    const getTopPrompts = (view) => {
      if (!isHooded) {
        if (view === 'front') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on shirt, crew neck, front view, preserve clothing details, sharp text, high fidelity texture`;
        if (view === 'back') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on shirt, back view, preserve clothing details, high fidelity texture`;
        if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, casual street style, wearing the shirt, preserve clothing details, sharp text, high fidelity texture`;
      } else {
        if (view === 'front') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood down resting on shoulders, NOT on head, front view, preserve clothing details, sharp text, high fidelity texture`;
        if (view === 'back') return `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood up on head, back view, preserve clothing details, high fidelity texture`;
        if (view === 'lifestyle') return `lifestyle photography of single ${modelTerm} standing, looks like a surfer, messy hair, wearing the clothing, preserve clothing details, sharp text, high fidelity texture`;
      }
    };

    let task, taskId;
    const STANDARD_BG = "very light grey professional studio background, hex color #F5F5F5, soft shadows";
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

    if (shotIndex === 0) {
      // Shot 1: Front
      taskId = "REGEN_SHOT_1";
      const prompt = isBottom
        ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, front view, wearing the clothing, no upper body focus`
        : getTopPrompts('front');

      task = await triggerClaidGeneration(taskId, frontUrl, prompt, STANDARD_BG, SHOT_ASPECT_RATIO, apiKey);

    } else if (shotIndex === 1) {
      // Shot 2: Back
      taskId = "REGEN_SHOT_2";
      const prompt = isBottom
        ? `fashion photography of ${modelTerm}, waist down shot, focus on legs and pants/shorts, back view, wearing the clothing, no upper body focus`
        : getTopPrompts('back');

      task = await triggerClaidGeneration(taskId, backUrl, prompt, STANDARD_BG, SHOT_ASPECT_RATIO, apiKey);

    } else if (shotIndex === 2) {
      // Shot 3: Lifestyle
      taskId = "REGEN_SHOT_3";
      const prompt = isBottom
        ? `lifestyle photography of single ${modelTerm} walking away, focus on pants/shorts, wearing the clothing`
        : getTopPrompts('lifestyle');

      task = await triggerClaidGeneration(taskId, frontUrl, prompt, BEACH_BG, SHOT_ASPECT_RATIO, apiKey, customBgUrl);
    } else {
      throw new Error("Invalid shotIndex (0-2)");
    }

    const url = await pollClaidTask(taskId, task.result_url, apiKey);
    return { url, shotIndex };
  }

  module.exports = {
    generateOnModelAndGhost,
    generateSingleShot
  };