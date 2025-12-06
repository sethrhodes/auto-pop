// backend/tagParser.js

function parseTagMetadata(rawText = "") {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Brand: any line that contains "surf shop" (customize per brand later)
  const brandLine =
    lines.find((l) => l.toLowerCase().includes("surf shop")) || "";

  // Price: first $xx.xx looking thing
  const priceMatch = rawText.match(/\$?\s?(\d{1,3}(?:\.\d{2})?)/);
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