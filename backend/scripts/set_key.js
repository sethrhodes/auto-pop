/**
 * Set (or replace) an encrypted API key in UserSettings.
 * Reads the secret from stdin so it never appears in argv, shell history or logs.
 *
 *   read -rs -p "key: " K && printf %s "$K" | node scripts/set_key.js IMAGE_API_KEY 2
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { UserSettings, encrypt, decrypt } = require("../database");

const keyName = process.argv[2];
const userId = parseInt(process.argv[3], 10);
if (!keyName || !userId) { console.error("usage: set_key.js <KEY_NAME> <userId>  (value on stdin)"); process.exit(1); }

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", async () => {
  const value = buf.trim();
  if (!value) { console.error("No value on stdin."); process.exit(1); }

  const enc = encrypt(value);
  const existing = await UserSettings.findOne({ where: { user_id: userId, key_name: keyName } });

  if (existing) {
    await existing.update({ iv: enc.iv, key_value: enc.content });
    console.log(`updated ${keyName} for user ${userId}`);
  } else {
    await UserSettings.create({ user_id: userId, key_name: keyName, iv: enc.iv, key_value: enc.content });
    console.log(`created ${keyName} for user ${userId}`);
  }

  // Read back through the app's own decrypt path.
  const row = await UserSettings.findOne({ where: { user_id: userId, key_name: keyName } });
  const ok = decrypt({ iv: row.iv, content: row.key_value }) === value;
  console.log(ok ? `verified: decrypts correctly (${value.length} chars)` : "VERIFY FAILED");
  process.exit(ok ? 0 : 1);
});
