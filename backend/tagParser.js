// backend/tagParser.js

function parseTagMetadata(rawText = "") {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Brand: any line that contains "surf shop" (customize per brand later)
  const brandLine =
    lines.find((l) => l.toLowerCase().includes("surf shop")) || "";

  // Price: Look for explicit prices with $ sign first, from bottom up
  // Regex matches: $12.34, $ 12.34, 12.34 (if loose), $12
  // We reverse lines to find the "final" price often at the bottom
  const reverseLines = [...lines].reverse();

  // 1. Strict match with $ symbol
  let priceMatch = null;
  for (const line of reverseLines) {
    const match = line.match(/\$\s?(\d{1,4}(?:\.\d{2})?)/);
    if (match) {
      priceMatch = match;
      break;
    }
  }

  // 2. Fallback: Look for XX.99 or XX.00 pattern if no $ found
  if (!priceMatch) {
    for (const line of reverseLines) {
      const match = line.match(/(\d{1,4}\.(?:99|00|95|50))/);
      if (match) {
        priceMatch = match;
        break;
      }
    }
  }

  const price = priceMatch ? priceMatch[1] : "";

  // SKU: line of all caps letters/digits, ~6+ chars, not a URL
  const skuLine =
    lines.find(
      (l) =>
        /^[A-Z0-9]+$/.test(l.replace(/\s+/g, "")) &&
        l.length >= 6 &&
        !l.toLowerCase().includes(".com")
    ) || "";

  // Product line: line with HOODY/HOODIE/TEE/etc.
  const productLine =
    lines.find((l) => /hood[iey]/i.test(l) || /tee|shirt|crew/i.test(l)) || "";

  const parts = productLine.split(/\s+/);

  const maybeColor = parts.find((p) =>
    ["BLK", "BLACK"].includes(p.toUpperCase())
  );
  const maybeSize = parts.find((p) =>
    ["XS", "S", "M", "L", "XL", "XXL"].includes(p.toUpperCase())
  );

  const color =
    maybeColor?.toUpperCase() === "BLK"
      ? "Black"
      : maybeColor || "";

  const size = maybeSize || "";

  // Human-friendly product type (strip codes + color/size)
  const cleanProductType = productLine
    .replace(/NC\s+/i, "") // strip NC code prefix
    .replace(/\bBLK\b/i, "") // strip color code
    .replace(/\b(XS|S|M|L|XL|XXL)\b/i, "") // strip size
    .replace(/\s+/g, " ")
    .trim();

  return {
    brand: brandLine,
    productType: cleanProductType || productLine,
    color,
    size,
    sku: skuLine,
    price,
    rawLines: lines,
  };
}

module.exports = { parseTagMetadata };