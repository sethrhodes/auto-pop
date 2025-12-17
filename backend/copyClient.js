// backend/copyClient.js
const axios = require("axios");
require("dotenv").config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

/**
 * Generate structured product copy from tag text + basic metadata.
 *
 * Returns:
 * {
 *   title: string,
 *   subtitle: string,
 *   description: string,
 *   bullets: string[],
 *   seo_keywords: string[]
 * }
 */
async function generateProductCopy({
  tagText,
  brand,
  productType,
  styleNotes,
}) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY must be set in backend/.env");
  }

  const systemPrompt = `
You are an ecommerce copywriter for apparel brands.
Given garment tag text and basic context, you create concise,
conversion-focused product copy for an online store.

Output MUST be valid JSON ONLY, with this shape:

{
  "title": "string - product name for PDP",
  "subtitle": "string - short one-line value prop or style hook",
  "description": "string - 2–4 sentences of detailed description",
  "bullets": ["string", "..."],
  "seo_keywords": ["string", "..."]
}

Keep tone clean and modern. Do not invent wild features.
Infer size/material/care/fit only if clearly implied.
If info is missing, stay generic rather than guessing.
  `.trim();

  const userPayload = {
    tag_text: tagText || "",
    brand: brand || "",
    product_type: productType || "",
    style_notes: styleNotes || "",
  };

  const messages = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content:
        "Here is the raw garment info as JSON:\n\n" +
        JSON.stringify(userPayload, null, 2),
    },
  ];

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 400,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  const message = response.data.choices?.[0]?.message?.content?.trim();

  if (!message) {
    throw new Error("No content returned from OpenAI");
  }

  // Sanitize Markdown JSON code blocks
  const cleanMessage = message.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();

  // Try to parse JSON; if it fails, wrap as fallback
  try {
    const parsed = JSON.parse(cleanMessage);
    return parsed;
  } catch (err) {
    // Fallback: return plain text wrapped in a simple structure
    return {
      title: "",
      subtitle: "",
      description: message,
      bullets: [],
      seo_keywords: [],
      _raw: message,
    };
  }
}

module.exports = {
  generateProductCopy,
};