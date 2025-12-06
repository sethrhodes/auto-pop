// backend/imageGenClient.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const IMAGE_API_URL =
  process.env.IMAGE_API_URL || "https://api.claid.ai/v1/image/ai-fashion-models";
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;

// Small helper to sleep between polling attempts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Claid AI Fashion Models and return 2 on-model + 2 "ghost" image URLs.
 *
 * NOTE (for now):
 *  - We ignore the local front/back files and use Claid's sample clothing URL
 *    just to prove the integration + credits are working.
 *  - Once we set up public hosting (e.g. S3 or Claid Web Folder), we’ll swap
 *    in real URLs for the uploaded garment images.
 */
async function generateOnModelAndGhost({ frontFilename, backFilename }) {
  if (!IMAGE_API_KEY) {
    throw new Error("IMAGE_API_KEY must be set in backend/.env");
  }

  // Sanity check that the files exist on disk (even though we don’t send them yet)
  const frontPath = path.join(__dirname, "uploads", frontFilename);
  const backPath = path.join(__dirname, "uploads", backFilename);

  if (!fs.existsSync(frontPath)) {
    throw new Error(`Front image not found at: ${frontPath}`);
  }
  if (!fs.existsSync(backPath)) {
    throw new Error(`Back image not found at: ${backPath}`);
  }

  // 🔹 For this FIRST TEST we use Claid's sample clothing URL so their servers
  // can reach it (your localhost images are not reachable from the internet).
  const clothingUrls = [
    "https://images.claid.ai/photoshoot-templates/assets/images/b63641ea19dd4dac8fdc02a6195873f0.jpeg",
  ];

  const payload = {
    input: {
      clothing: clothingUrls,
    },
    options: {
      pose: "full body, front view, neutral stance, arms relaxed",
      background:
        "minimalistic studio background, ecommerce product photography, soft even lighting",
      // You can add more options later from:
      // https://docs.claid.ai/ai-fashion-models-api/ai-fashion-models-options
    },
  };

  console.log("Calling Claid AI Fashion Models...");

  // 1) Kick off async generation
  const startRes = await axios.post(IMAGE_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${IMAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const task = startRes.data?.data;
  if (!task || !task.result_url) {
    console.error("Unexpected Claid response:", startRes.data);
    throw new Error("Claid response missing data.result_url");
  }

  console.log("Claid task accepted:", {
    id: task.id,
    status: task.status,
    result_url: task.result_url,
  });

  // 2) Poll result_url until status === DONE
  const maxAttempts = 15; // ~30 seconds if delayMs = 2000
  const delayMs = 2000;
  let lastStatus = task.status;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await axios.get(task.result_url, {
      headers: {
        Authorization: `Bearer ${IMAGE_API_KEY}`,
      },
    });

    const body = res.data;
    const data = body?.data;
    const status = data?.status;

    console.log(`Claid poll attempt ${attempt}, status: ${status}`);

    if (status === "DONE") {
      const outputObjects = data?.result?.output_objects || [];

      // Extract URLs (tmp_url is a temporary direct URL)  [oai_citation:2‡docs.claid.ai](https://docs.claid.ai/ai-fashion-models-api/async-api-reference)
      const urls = outputObjects
        .map((obj) => obj.tmp_url || obj.claid_storage_uri || null)
        .filter(Boolean);

      if (!urls.length) {
        throw new Error("Claid DONE but no output URLs found");
      }

      // Map into 2 on-model + 2 ghost slots
      const onModel = urls.slice(0, 2).map((url) => ({ url }));

      let ghost = urls.slice(2, 4).map((url) => ({ url }));
      // If not enough distinct ghost images, repeat from the start
      while (ghost.length < 2 && urls.length > 0) {
        ghost.push({ url: urls[0] });
      }

      return { onModel, ghost };
    }

    if (status === "ERROR") {
      console.error("Claid returned ERROR:", data?.errors);
      throw new Error(
        "Claid reported ERROR: " + JSON.stringify(data?.errors || [])
      );
    }

    lastStatus = status;

    if (attempt === maxAttempts) {
      throw new Error(
        `Timed out waiting for Claid result. Last status: ${lastStatus}`
      );
    }

    await sleep(delayMs);
  }

  // Should never get here
  throw new Error(
    `Failed to get Claid result after ${maxAttempts} attempts (last status: ${lastStatus})`
  );
}

module.exports = {
  generateOnModelAndGhost,
};