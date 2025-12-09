const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

const WESHOP_API_KEY = process.env.WESHOP_API_KEY;
const WESHOP_BASE_URL = "https://openapi.weshop.ai/openapi/v1";

// Helper to sleep
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a local file to WeShop to get a public asset URL.
 */
async function uploadToWeShop(filePath) {
    if (!WESHOP_API_KEY) throw new Error("WESHOP_API_KEY missing");

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("type", "image");

    console.log("Uploading to WeShop:", filePath);

    try {
        const res = await axios.post(`${WESHOP_BASE_URL}/asset/upload/image`, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: WESHOP_API_KEY, // WeShop usually expects raw key or Bearer space? 
                // Documentation often implies header "Authorization: key"
            },
        });

        // Response format usually: { code: 200, data: { url: "..." } }
        const url = res.data?.data?.url;
        if (!url) throw new Error("No URL returned from WeShop upload");
        return url;
    } catch (err) {
        console.error("WeShop Upload Error:", err.response?.data || err.message);
        throw new Error("WeShop Upload Failed");
    }
}

/**
 * Create a Mannequin-to-Model Task
 */
async function triggerWeShopTask(taskId, imageUrl, type) {
    // Note: This payload is estimated based on common "Mannequin" agent structure.
    // We strictly need the user to verify the exact "agent_id" or "template_id" for Front/Back.
    // For now, we will use a generic "mannequin_to_model" placeholder configuration.

    const payload = {
        agent_type: "mannequin_model", // Hypothetical agent type
        input_image: imageUrl,
        prompt: type === "FRONT_MODEL" ? "Front view, walking pose" : "Back view, standing",
        quantity: 1
    };

    console.log(`[${taskId}] Triggering WeShop Task...`);

    // WeShop typically uses /task/create or /agent/task
    // We will assume a standard /task structure for now.
    const res = await axios.post(`${WESHOP_BASE_URL}/task`, payload, {
        headers: {
            "Content-Type": "application/json",
            Authorization: WESHOP_API_KEY
        }
    });

    const taskData = res.data?.data;
    if (!taskData || !taskData.task_id) {
        throw new Error(`[${taskId}] WeShop task creation failed`);
    }
    return taskData.task_id;
}

/**
 * Poll WeShop Task
 */
async function pollWeShopTask(taskId, weShopTaskId) {
    const maxAttempts = 30;
    const delayMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
        await sleep(delayMs);

        const res = await axios.get(`${WESHOP_BASE_URL}/task/${weShopTaskId}`, {
            headers: { Authorization: WESHOP_API_KEY }
        });

        const status = res.data?.data?.status; // e.g., "SUCCEEDED", "FAILED", "PROCESSING"
        console.log(`[${taskId}] Status: ${status}`);

        if (status === "SUCCEEDED") {
            return res.data?.data?.result_image_url;
        }
        if (status === "FAILED") {
            throw new Error(`[${taskId}] WeShop Task Failed`);
        }
    }
    throw new Error(`[${taskId}] Timeout`);
}

async function generateOnModelAndGhost({ frontFilename, backFilename }) {
    if (!WESHOP_API_KEY) {
        throw new Error("Missing WESHOP_API_KEY in .env");
    }

    const frontPath = path.join(__dirname, "uploads", frontFilename);
    const backPath = path.join(__dirname, "uploads", backFilename);

    // 1. Upload Images
    // WeShop also supports background removal, so we could do that here too.
    const [frontUrl, backUrl] = await Promise.all([
        uploadToWeShop(frontPath),
        uploadToWeShop(backPath)
    ]);

    // 2. Trigger Tasks (Sequential or Parallel - WeShop might have limits too)
    const frontTaskId = await triggerWeShopTask("FRONT_MODEL", frontUrl, "FRONT_MODEL");
    const backTaskId = await triggerWeShopTask("BACK_MODEL", backUrl, "BACK_MODEL");

    // 3. Poll
    const [frontModelUrl, backModelUrl] = await Promise.all([
        pollWeShopTask("FRONT_MODEL", frontTaskId),
        pollWeShopTask("BACK_MODEL", backTaskId)
    ]);

    return {
        onModel: [{ url: frontModelUrl }, { url: backModelUrl }],
        ghost: [{ url: frontUrl }, { url: backUrl }] // Return uploaded URLs as ghosts
    };
}

module.exports = { generateOnModelAndGhost };
