/**
 * Add any columns the Sequelize models declare but the SQLite tables lack.
 *
 * initDB() uses plain sequelize.sync(), which creates missing TABLES but never
 * alters existing ones (alter:true previously corrupted the DB). So deploying
 * code with a new model field leaves the table behind, and since Sequelize
 * SELECTs every model column, every query on that table throws
 * "no such column". This closes that gap additively.
 *
 *   node scripts/sync_schema.js            # dry run
 *   node scripts/sync_schema.js --apply
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../database");
const { sequelize } = db;

// Only nullable columns can be added safely without a default.
const sqliteType = (attr) => {
  const t = (attr.type && attr.type.key) || "STRING";
  switch (t) {
    case "INTEGER": case "BIGINT": return "INTEGER";
    case "FLOAT": case "DOUBLE": case "DECIMAL": return "REAL";
    case "BOOLEAN": return "TINYINT(1)";
    case "DATE": case "DATEONLY": return "DATETIME";
    default: return "TEXT";
  }
};

(async () => {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "MODE: APPLY\n" : "MODE: DRY RUN (nothing written)\n");

  const models = Object.values(sequelize.models);
  let pending = 0;

  for (const M of models) {
    const table = M.getTableName();
    const [cols] = await sequelize.query(`PRAGMA table_info('${table}')`);
    if (!cols.length) { console.log(`${table}: table does not exist — sync() will create it`); continue; }
    const have = cols.map((c) => c.name);

    const missing = Object.entries(M.rawAttributes)
      .map(([k, a]) => ({ name: a.field || k, attr: a }))
      .filter((c) => !have.includes(c.name));

    if (!missing.length) { console.log(`${table}: up to date`); continue; }

    for (const c of missing) {
      if (c.attr.allowNull === false && c.attr.defaultValue === undefined) {
        console.log(`  [SKIP] ${table}.${c.name} — NOT NULL with no default, needs a manual migration`);
        continue;
      }
      const ddl = `ALTER TABLE \`${table}\` ADD COLUMN \`${c.name}\` ${sqliteType(c.attr)}`;
      pending++;
      if (!apply) { console.log(`  [would add] ${table}.${c.name}  ->  ${ddl}`); continue; }
      await sequelize.query(ddl);
      const [after] = await sequelize.query(`PRAGMA table_info('${table}')`);
      if (!after.map((x) => x.name).includes(c.name)) throw new Error(`verify failed: ${table}.${c.name}`);
      console.log(`  [added] ${table}.${c.name} (verified)`);
    }
  }

  if (apply) {
    // Prove every model can now be queried the way the app queries it.
    for (const M of models) {
      await M.findAll({ limit: 1 });
      console.log(`  query ok: ${M.getTableName()}`);
    }
  }
  console.log(pending ? `\n${pending} column(s) ${apply ? "added" : "pending"}` : "\nNothing to do.");
  await sequelize.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
