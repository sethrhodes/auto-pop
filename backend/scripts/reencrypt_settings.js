/**
 * One-off: re-encrypt UserSettings values from the old hardcoded ENCRYPTION_SECRET
 * to the one now set in .env.
 *
 * Values were encrypted with the repo's public dev fallback. Setting a real
 * ENCRYPTION_SECRET made them undecryptable; this rewrites them in place.
 *
 *   node scripts/reencrypt_settings.js            # dry run, writes nothing
 *   node scripts/reencrypt_settings.js --apply    # perform the migration
 */
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { UserSettings, sequelize } = require("../database");

const ALGORITHM = "aes-256-cbc";
const OLD_SECRET = "dev_secret_key_32_bytes_long_string!!"; // public repo fallback
const NEW_SECRET = process.env.ENCRYPTION_SECRET;

const keyFrom = (secret) => crypto.scryptSync(secret, "salt", 32);

function tryDecrypt(row, secret) {
  try {
    const d = crypto.createDecipheriv(ALGORITHM, keyFrom(secret), Buffer.from(row.iv, "hex"));
    const out = Buffer.concat([d.update(Buffer.from(row.key_value, "hex")), d.final()]).toString();
    // A wrong key usually throws on padding, but can slip through with garbage.
    // Real values are printable ASCII, so require that.
    return /^[\x20-\x7E]+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

function encryptWith(text, secret) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv(ALGORITHM, keyFrom(secret), iv);
  const content = Buffer.concat([c.update(text), c.final()]);
  return { iv: iv.toString("hex"), content: content.toString("hex") };
}

(async () => {
  const apply = process.argv.includes("--apply");
  if (!NEW_SECRET) throw new Error("ENCRYPTION_SECRET not set in .env — nothing to migrate to");
  if (NEW_SECRET === OLD_SECRET) throw new Error("ENCRYPTION_SECRET is still the old default — nothing to do");

  const rows = await UserSettings.findAll();
  console.log(`${rows.length} setting row(s) found`);
  console.log(apply ? "MODE: APPLY\n" : "MODE: DRY RUN (nothing will be written)\n");

  let migrate = 0, already = 0, stuck = 0;

  for (const row of rows) {
    const label = `user ${row.user_id} / ${row.key_name}`;

    if (tryDecrypt(row, NEW_SECRET)) { console.log(`  [skip]    ${label} — already on the new secret`); already++; continue; }

    const plain = tryDecrypt(row, OLD_SECRET);
    if (!plain) { console.log(`  [STUCK]   ${label} — decrypts with neither key`); stuck++; continue; }

    if (apply) {
      const enc = encryptWith(plain, NEW_SECRET);
      await row.update({ iv: enc.iv, key_value: enc.content });
      // Read back through the same path the app uses.
      const check = tryDecrypt(await UserSettings.findByPk(row.id), NEW_SECRET);
      if (check !== plain) throw new Error(`verify failed for ${label} — aborting`);
      console.log(`  [migrated] ${label} (${plain.length} chars, verified)`);
    } else {
      console.log(`  [would migrate] ${label} (${plain.length} chars recovered)`);
    }
    migrate++;
  }

  console.log(`\nmigrated: ${migrate}   already current: ${already}   unrecoverable: ${stuck}`);
  if (stuck) console.log("Unrecoverable rows must be re-entered in Settings.");
  await sequelize.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
