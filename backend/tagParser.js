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

  // SKU: Look for valid tokens (A-Z0-9, 6+ chars) that are NOT blocked words
  const SKIP_WORDS = new Set([
    "NORCAL", "NOR-CAL", "ORIGINAL", "HOODY", "HOODIE", "CALIFORNIA", "SURFSHOP",
    "COTTON", "POLYESTER", "MEDIUM", "LARGE", "SMALL", "XSMALL", "XXLARGE",
    "CHINA", "WASH", "MACHINE", "TUMBLE", "BLEACH", "REMOVE", "DECORATION"
  ]);

  let foundSku = "";
  // Scan all lines/tokens
  for (const line of lines) {
    const tokens = line.split(/\s+/);
    for (const token of tokens) {
      // clean potential trailing punctuation. Uppercase first to avoid stripping lowercase valid chars if any,
      // and to ensure garbage strings are fully expanded to their real length.
      const cleanToken = token.toUpperCase().replace(/[^A-Z0-9-]/g, "");

      // Validation:
      // 1. Length >= 6
      // 2. Not a URL (handled by regex mostly, but check .com)
      // 3. Not in skip list
      // 4. Matches strictly caps/nums (allowing hyphen?)
      if (
        cleanToken.length >= 6 &&
        cleanToken.length <= 16 &&
        /^[A-Z0-9-]+$/.test(cleanToken) &&
        !SKIP_WORDS.has(cleanToken) &&
        !cleanToken.includes(".COM") &&
        !cleanToken.match(/^\d+\.\d{2}$/) // not a price like 54.95
      ) {
        // Prefer alphanumeric mixed, but plain text is okay if not skipped.
        // Current case: NCHOGBLKM is 9 chars.
        console.log("Found Potential SKU:", cleanToken); // Log found token
        foundSku = cleanToken;
        break;
      } else if (cleanToken.length >= 6) {
        // console.log("Skipped Token:", cleanToken); // Debug skipped
      }
    }
    if (foundSku) break;
  }

  const skuLine = foundSku; // Mapping to old variable name (it's just the SKU now, not whole line)

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

  // Strip size suffix from SKU (e.g. NCHOGBLKM -> NCHOGBLK)
  let cleanSku = skuLine;
  if (cleanSku) {
    const suffixRegex = /(.*)(2XL|XL|L|M|S)$/;
    const match = cleanSku.match(suffixRegex);
    if (match) {
      cleanSku = match[1];
    }
  }

  return {
    brand: brandLine,
    productType: cleanProductType || productLine,
    color,
    size,
    sku: cleanSku,
    price,
    rawLines: lines,
  };
}

module.exports = { parseTagMetadata };