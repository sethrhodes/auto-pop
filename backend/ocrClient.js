// backend/ocrClient.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const sharp = require("sharp");
require("dotenv").config();

async function extractTagText({ tagFilename, apiKeys = {} }) {
  const apiKey = apiKeys.OCR_API_KEY || process.env.OCR_API_KEY;
  const apiUrl = process.env.OCR_API_URL || "https://api.ocr.space/parse/image";

  // Fallback if no key provided
  const resolvedKey = apiKey || 'helloworld';

  const filePath = path.join(__dirname, "uploads", tagFilename);
  if (!fs.existsSync(filePath)) {
    throw new Error("Tag image not found");
  }

  try {
    // Resize image to ensure it's under 1MB limit for free OCR API
    const resizedBuffer = await sharp(filePath)
      .resize({ width: 1000, height: 1000, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const form = new FormData();
    // Pass buffer with filename and contentType options
    form.append("file", resizedBuffer, { filename: "tag.jpg", contentType: "image/jpeg" });
    form.append("language", "eng");
    form.append("isOverlayRequired", "false");
    form.append("apikey", resolvedKey);
    form.append("OCREngine", "2"); // Better for special fonts

    const response = await axios.post(apiUrl, form, {
      headers: {
        ...form.getHeaders()
      }
    });

    if (response.data.IsErroredOnProcessing) {
      throw new Error(response.data.ErrorMessage);
    }

    const parsedResults = response.data.ParsedResults;
    if (!parsedResults || parsedResults.length === 0) {
      return { rawText: "" };
    }

    const rawText = parsedResults[0].ParsedText;
    // console.log("OCR Raw:", rawText);

    return { rawText };

  } catch (error) {
    console.error("OCR API Error:", error.message);
    return { rawText: "" };
  }
}

module.exports = { extractTagText };