/**
 * Copy encrypted API keys from one user to another.
 * Decrypts with the current ENCRYPTION_SECRET and re-encrypts under a fresh IV.
 *
 *   node scripts/copy_keys.js <fromUserId> <toUserId>            # dry run
 *   node scripts/copy_keys.js <fromUserId> <toUserId> --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { UserSettings, encrypt, decrypt, sequelize } = require("../database");

const from = parseInt(process.argv[2], 10);
const to = parseInt(process.argv[3], 10);
const apply = process.argv.includes("--apply");
if (!from || !to) { console.error("usage: copy_keys.js <fromUserId> <toUserId> [--apply]"); process.exit(1); }

(async () => {
  const src = await UserSettings.findAll({ where: { user_id: from } });
  if (!src.length) { console.log(`user ${from} has no settings rows`); process.exit(0); }

  console.log(apply ? "MODE: APPLY\n" : "MODE: DRY RUN (nothing written)\n");

  for (const row of src) {
    const plain = decrypt({ iv: row.iv, content: row.key_value });
    const existing = await UserSettings.findOne({ where: { user_id: to, key_name: row.key_name } });
    const verb = existing ? "overwrite" : "create";

    if (!apply) { console.log(`  [would ${verb}] ${row.key_name} -> user ${to} (${plain.length} chars)`); continue; }

    const enc = encrypt(plain);
    if (existing) await existing.update({ iv: enc.iv, key_value: enc.content });
    else await UserSettings.create({ user_id: to, key_name: row.key_name, iv: enc.iv, key_value: enc.content });

    const back = await UserSettings.findOne({ where: { user_id: to, key_name: row.key_name } });
    const ok = decrypt({ iv: back.iv, content: back.key_value }) === plain;
    if (!ok) throw new Error(`verify failed for ${row.key_name}`);
    console.log(`  [${verb}d] ${row.key_name} -> user ${to} (${plain.length} chars, verified)`);
  }

  const total = await UserSettings.count({ where: { user_id: to } });
  console.log(`\nuser ${to} now has ${total} key(s)`);
  await sequelize.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
