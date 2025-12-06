// backend/ocrClient.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");
require("dotenv").config();

const OCR_API_URL =
  process.env.OCR_API_URL || "https://api.ocr.space/parse/image";
const OCR_API_KEY = process.env.OCR_API_KEY;

const MAX_OCR_SIZE_BYTES = 1024 * 1024; // 1 MB

/**
 * Use OCR.Space to extract text from a saved tag image.
 *
 * Returns:
 * {
 *   rawText: "full text from tag",
 *   lines: ["line 1", "line 2", ...],
 *   ocr: { ...full OCR response... }
 * }
 */
async function extractTagText({ tagFilename }) {
  if (!OCR_API_KEY) {
    throw new Error("OCR_API_KEY must be set in backend/.env");
  }

  if (!tagFilename) {
    throw new Error("tagFilename is required");
  }

  const tagPath = path.join(__dirname, "uploads", tagFilename);
  if (!fs.existsSync(tagPath)) {
    throw new Error(`Tag image not found at: ${tagPath}`);
  }

  // Decide which file to send (original or compressed)
  let fileToSendPath = tagPath;
  const { size } = fs.statSync(tagPath);

  if (size > MAX_OCR_SIZE_BYTES) {
    console.log(
      `Tag image is ${size} bytes (>1MB). Compressing before OCR...`
    );

    const compressedName = `ocr-${Date.now()}-${tagFilename}.jpg`;
    const compressedPath = path.join(__dirname, "uploads", compressedName);

    // Simple strategy: resize to max width ~1200px, JPEG quality 70
    await sharp(tagPath)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(compressedPath);

    const { size: newSize } = fs.statSync(compressedPath);
    console.log(`Compressed tag image to ${newSize} bytes: ${compressedPath}`);

    fileToSendPath = compressedPath;
  }

  const form = new FormData();
  form.append("file", fs.createReadStream(fileToSendPath));
  form.append("apikey", OCR_API_KEY);
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");

  const res = await axios.post(OCR_API_URL, form, {
    headers: form.getHeaders(),
  });

  const body = res.data;

  if (body.IsErroredOnProcessing) {
    const msg =
      (Array.isArray(body.ErrorMessage)
        ? body.ErrorMessage.join("; ")
        : body.ErrorMessage) || "Unknown OCR error";
    throw new Error(`OCR.Space error: ${msg}`);
  }

  const parsedResults = body.ParsedResults || [];
  const text = parsedResults
    .map((r) => r.ParsedText || "")
    .join("\n\n")
    .trim();

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    rawText: text,
    lines,
    ocr: body,
  };
}

module.exports = {
  extractTagText,
};