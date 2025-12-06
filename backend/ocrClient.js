const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
require("dotenv").config();

// This function expects a filename that exists in backend/uploads/
async function extractTextFromTag(filename) {
  const ocrEndpoint = process.env.OCR_API_URL;  // e.g. https://api.ocr-provider.com/parse/image
  const ocrApiKey = process.env.OCR_API_KEY;    // whatever your provider uses

  if (!ocrEndpoint || !ocrApiKey) {
    throw new Error("OCR_API_URL and OCR_API_KEY must be set in .env");
  }

  const filePath = path.join(__dirname, "uploads", filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Tag file not found: ${filePath}`);
  }

  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));

  // NOTE:
  // Each OCR provider has its own fields. For now, we'll use generic "file"
  // and "apikey" as an example. Adjust these once you pick a real service.
  form.append("apikey", ocrApiKey);

  const response = await axios.post(ocrEndpoint, form, {
    headers: {
      ...form.getHeaders(),
    },
    // some APIs use query params instead of body fields:
    // params: { apikey: ocrApiKey },
  });

  // Adjust this parsing based on the real provider's response shape.
  // For now we'll assume it returns something like { text: "..." }
  const data = response.data;

  // TODO: customize based on your real API
  if (data.text) {
    return data.text;
  }

  // fallback: just return the whole response so you can inspect it
  return JSON.stringify(data);
}

module.exports = {
  extractTextFromTag,
};