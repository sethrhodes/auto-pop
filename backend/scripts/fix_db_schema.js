const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

const queries = [
    "ALTER TABLE Products ADD COLUMN gender TEXT;",
    "ALTER TABLE Products ADD COLUMN category TEXT;",
    "ALTER TABLE Products ADD COLUMN is_hooded BOOLEAN;"
];

db.serialize(() => {
    queries.forEach(query => {
        db.run(query, (err) => {
            if (err) {
                if (err.message.includes("duplicate column name")) {
                    console.log(`Column already exists (skipped): ${query}`);
                } else {
                    console.error("Error executing:", query, err.message);
                }
            } else {
                console.log("Success:", query);
            }
        });
    });
});

db.close((err) => {
    if (err) {
        console.error(err.message);
        process.exit(1);
    }
    console.log('Close the database connection.');
    process.exit(0);
});
