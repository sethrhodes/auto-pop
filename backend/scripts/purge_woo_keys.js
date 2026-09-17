/**
 * One-off: delete the WooCommerce credentials from UserSettings.
 *
 * The Shopify migration removed wooClient.js and nothing reads WC_* any more.
 * These same values leaked publicly via .env.example in commit 1e9b414, so they
 * are being removed here AND must be revoked in WooCommerce itself.
 *
 *   node scripts/purge_woo_keys.js            # dry run
 *   node scripts/purge_woo_keys.js --apply    # delete
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { UserSettings, sequelize } = require("../database");

const TARGETS = ["WC_BASE_URL", "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET"];

(async () => {
  const apply = process.argv.includes("--apply");
  const rows = await UserSettings.findAll();

  const doomed = rows.filter((r) => TARGETS.includes(r.key_name));
  const keep = rows.filter((r) => !TARGETS.includes(r.key_name));

  console.log(apply ? "MODE: APPLY\n" : "MODE: DRY RUN (nothing will be deleted)\n");
  console.log(`  to delete: ${doomed.length}`);
  for (const r of doomed) console.log(`    - user ${r.user_id} / ${r.key_name}`);
  console.log(`\n  to keep:   ${keep.length}`);
  for (const r of keep) console.log(`    + user ${r.user_id} / ${r.key_name}`);

  if (apply) {
    const n = await UserSettings.destroy({ where: { key_name: TARGETS } });
    const left = await UserSettings.count({ where: { key_name: TARGETS } });
    const survivors = await UserSettings.count();
    console.log(`\n  deleted ${n} row(s); WC rows remaining: ${left}; total settings rows: ${survivors}`);
    if (left !== 0) throw new Error("WC rows still present after delete");
  }
  await sequelize.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
