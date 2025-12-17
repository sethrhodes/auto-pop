// backend/imageGenClient.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const IMAGE_API_URL =
  process.env.IMAGE_API_URL || "https://api.claid.ai/v1/image/ai-fashion-models";
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;


// Helper to sleep
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a local file to Claid to get a temporary public URL.
 * We use a minimal "resize" op or similar to trigger the upload flow.
 */
async function uploadToClaid(filePath) {
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
      Authorization: `Bearer ${IMAGE_API_KEY}`,
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
async function triggerClaidGeneration(taskId, imageUrl, pose, aspectRatio = "3:4") {
  const payload = {
    input: {
      clothing: [imageUrl] // Send only the specific side
    },
    options: {
      pose: pose,
      background: "minimalistic studio background, ecommerce product photography, soft even lighting",
      aspect_ratio: aspectRatio
    },
  };

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      console.log(`[${taskId}] Triggering Claid generation (attempt ${attempt + 1})...`);
      const res = await axios.post(IMAGE_API_URL, payload, {
        headers: {
          Authorization: `Bearer ${IMAGE_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      const task = res.data?.data;
      if (!task || !task.result_url) {
        throw new Error(`[${taskId}] Claid response missing result_url`);
      }
      return task;

    } catch (err) {
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
async function pollClaidTask(taskId, resultUrl) {
  const maxAttempts = 20;
  const delayMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(delayMs);

    const res = await axios.get(resultUrl, {
      headers: { Authorization: `Bearer ${IMAGE_API_KEY}` },
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

async function generateOnModelAndGhost({ frontFilename, backFilename, gender = "female" }) {
  if (!IMAGE_API_KEY) {
    throw new Error("IMAGE_API_KEY must be set in backend/.env");
  }

  const frontPath = path.join(__dirname, "uploads", frontFilename);
  const backPath = path.join(__dirname, "uploads", backFilename);

  if (!fs.existsSync(frontPath)) throw new Error(`Front not found: ${frontPath}`);
  if (!fs.existsSync(backPath)) throw new Error(`Back not found: ${backPath}`);

  // 1. Upload both images (Ghost Images = These Uploads, roughly)
  // Ideally, we would run a "Remove Background" op here for true ghost mannequin,
  // but for now we return the uploaded "temporary" URLs which are accessible.
  // Note: These Claid temp URLs expire in 24h, which is fine for this session.
  const [frontUrl, backUrl] = await Promise.all([
    uploadToClaid(frontPath),
    uploadToClaid(backPath),
  ]);

  console.log("Uploaded Ghost/Source URLs:", { frontUrl, backUrl });

  // Determine model terms based on gender "Men" -> "male model", "Women" -> "female model"
  const modelTerm = gender && gender.toLowerCase().includes("men") ? "male model" : "female model";

  // 2. Trigger Sequential Model Generations (3 Shots)
  // Shot 1: Front Close Up (Waist Up - Hood Down)
  const task1 = await triggerClaidGeneration(
    "SHOT_1",
    frontUrl,
    `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood down resting on shoulders, NOT on head, front view, white background, studio lighting`,
    "3:4"
  );
  const url1 = await pollClaidTask("SHOT_1", task1.result_url);

  // Shot 2: Back Close Up (Waist Up - Hood Up)
  const task2 = await triggerClaidGeneration(
    "SHOT_2",
    backUrl,
    `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood up on head, back view, white background, studio lighting`,
    "3:4"
  );
  const url2 = await pollClaidTask("SHOT_2", task2.result_url);

  // Shot 3: Lifestyle 1 (Beach Walking)
  const task3 = await triggerClaidGeneration(
    "SHOT_3",
    frontUrl,
    `lifestyle photography of single ${modelTerm} standing on a rugged northern california beach, misty cliffs in background, moody atmosphere, looks like a surfer, messy hair, wearing the clothing, cinematic lighting`,
    "3:4"
  );
  const url3 = await pollClaidTask("SHOT_3", task3.result_url);

  // Shot 4: Lifestyle 2 (Urban Strut/Walking) - REMOVED
  // const task4 = await triggerClaidGeneration(...)

  // 4. Return formatted results as a "Gallery"
  return {
    gallery: [
      { label: "Front Detail", url: url1 }, // url1 is Front Close Up
      { label: "Back Detail", url: url2 },
      { label: "Beach Lifestyle", url: url3 }
    ]
  };
}

const SHOT_ASPECT_RATIO = "3:4";

async function generateSingleShot({ frontFilename, backFilename, gender = "female", shotIndex }) {
  if (!IMAGE_API_KEY) throw new Error("IMAGE_API_KEY must be set in backend/.env");

  const frontPath = path.join(__dirname, "uploads", frontFilename);
  const backPath = path.join(__dirname, "uploads", backFilename);

  if (!fs.existsSync(frontPath)) throw new Error(`Front not found: ${frontPath}`);
  if (!fs.existsSync(backPath)) throw new Error(`Back not found: ${backPath}`);

  // Upload or reuse? For simplicity, re-upload (Claid expiration etc).
  // Optimization: Could store temp URLs in frontend/backend state, but re-upload is safer.
  const [frontUrl, backUrl] = await Promise.all([
    uploadToClaid(frontPath),
    uploadToClaid(backPath),
  ]);

  const modelTerm = gender && gender.toLowerCase().includes("men") ? "male model" : "female model";
  let task, taskId;

  // Define logic for each shot (matches generateOnModelAndGhost)
  if (shotIndex === 0) {
    // Shot 1: Front Close Up
    taskId = "REGEN_SHOT_1";
    task = await triggerClaidGeneration(
      taskId,
      frontUrl,
      `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood down resting on shoulders, NOT on head, front view, neutral background, studio lighting`,
      SHOT_ASPECT_RATIO
    );
  } else if (shotIndex === 1) {
    // Shot 2: Back Close Up
    taskId = "REGEN_SHOT_2";
    task = await triggerClaidGeneration(
      taskId,
      backUrl,
      `fashion photography of ${modelTerm}, waist up shot, torso only, no legs, focus on hoodie, hood up on head, back view, neutral background, studio lighting`,
      SHOT_ASPECT_RATIO
    );
  } else if (shotIndex === 2) {
    // Shot 3: Lifestyle 1
    taskId = "REGEN_SHOT_3";
    task = await triggerClaidGeneration(
      taskId,
      frontUrl,
      `lifestyle photography of single ${modelTerm} standing on a rugged northern california beach, misty cliffs in background, moody atmosphere, looks like a surfer, messy hair, wearing the clothing, cinematic lighting`,
      SHOT_ASPECT_RATIO
    );

  } else {
    throw new Error("Invalid shotIndex (0-2)");
  }

  const url = await pollClaidTask(taskId, task.result_url);
  return { url, shotIndex };
}

module.exports = {
  generateOnModelAndGhost,
  generateSingleShot
};