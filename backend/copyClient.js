// backend/copyClient.js
const axios = require("axios");
require("dotenv").config();

async function generateProductCopy({ tagText, brand, productType, styleNotes, apiKeys = {} }) {
  const apiKey = apiKeys.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const systemPrompt = `
You are an expert e-commerce copywriter for a high-end fashion boutique called 'Nor Cal Surf Shop'.
Your style is:
- Cool, relaxed, authentic surfer vibe.
- Premium and detailed but not salesy.
- Focus on material quality and fit.
- Use words like 'stoked', 'premium', 'heavyweight', 'essential'.
`;

  const userPrompt = `
Generate product details based on this info:
TAG TEXT (OCR): "${tagText}"
DETECTED BRAND: "${brand}"
TYPE: "${productType}"
NOTES: "${styleNotes}"

Output ONLY valid JSON:
{
  "title": "A catchy, SEO-friendly 3-5 word title (e.g. 'Stussy Heavyweight Pigment Dyed Hoodie')",
  "price": "Estimated price (number only, e.g. 85.00) based on brand prestige. Stussy/Supreme = higher, Generic = lower.",
  "subtitle": "2 sentence hook for the product card.",
  "description": "Plain text only (no HTML). Concise, engaging product description. Maximum 3-4 sentences focusing on style and fit."
}
`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o", // or gpt-3.5-turbo
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    const content = response.data.choices[0].message.content;
    return JSON.parse(content);

  } catch (error) {
    console.error("OpenAI Copy Gen Error:", error.response ? error.response.data : error.message);
    // Fallback
    return {
      title: `${brand} ${productType} (Draft)`,
      price: "0.00",
      subtitle: "Cool item from Nor Cal Surf Shop.",
      description: "Fresh inventory. Details coming soon."
    };
  }
}

module.exports = { generateProductCopy };