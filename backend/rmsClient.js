// backend/rmsClient.js
const sql = require('mssql');
require('dotenv').config();
const { UserSettings, decrypt } = require('./database');

// Singleton pool
let poolPromise = null;

// Mock Inventory with Styles and Sizes (Variants)
const mockInventory = [
    // NorCal OG Hoodie (Black) - Style: NCHOGBLK
    { ItemLookupCode: 'NCHOGBLKS', StyleID: 'NCHOGBLK', Quantity: 10, Description: 'NorCal OG Hoodie Black (Small)', Price: 54.95, LastUpdated: new Date() },
    { ItemLookupCode: 'NCHOGBLKM', StyleID: 'NCHOGBLK', Quantity: 15, Description: 'NorCal OG Hoodie Black (Medium)', Price: 54.95, LastUpdated: new Date() },
    { ItemLookupCode: 'NCHOGBLKL', StyleID: 'NCHOGBLK', Quantity: 8, Description: 'NorCal OG Hoodie Black (Large)', Price: 54.95, LastUpdated: new Date() },
    { ItemLookupCode: 'NCHOGBLKXL', StyleID: 'NCHOGBLK', Quantity: 4, Description: 'NorCal OG Hoodie Black (XL)', Price: 54.95, LastUpdated: new Date() },

    // NorCal OG Hoodie (Grey) - Style: NCHOGGRY
    { ItemLookupCode: 'NCHOGGRYS', StyleID: 'NCHOGGRY', Quantity: 5, Description: 'NorCal OG Hoodie Grey (Small)', Price: 54.95, LastUpdated: new Date() },
    { ItemLookupCode: 'NCHOGGRYM', StyleID: 'NCHOGGRY', Quantity: 20, Description: 'NorCal OG Hoodie Grey (Medium)', Price: 54.95, LastUpdated: new Date() },

    // Test T-Shirt
    { ItemLookupCode: 'NCTEEBLKM', StyleID: 'NCTEEBLK', Quantity: 100, Description: 'NorCal Classic Tee Black (M)', Price: 25.00, LastUpdated: new Date() }
];

async function getConfig() {
    try {
        const settings = await UserSettings.findAll({ where: { user_id: 1 } });
        const keys = {};
        settings.forEach(s => {
            try {
                keys[s.key_name] = decrypt({ iv: s.iv, content: s.key_value });
            } catch (e) {
                // console.error("Decrypt fail", e); 
            }
        });

        const server = keys.RMS_HOST || process.env.RMS_HOST;

        return {
            user: keys.RMS_USER || process.env.RMS_USER,
            password: keys.RMS_PASSWORD || process.env.RMS_PASSWORD,
            server: server, // Might be 'simulation'
            database: keys.RMS_DATABASE || process.env.RMS_DATABASE,
            options: { encrypt: false, trustServerCertificate: true }
        };
    } catch (e) {
        console.error("Failed to load dynamic config", e);
        return { server: null };
    }
}

async function getPool() {
    const config = await getConfig();

    if (config.server === 'simulation') {
        return 'simulation';
    }

    if (!config.server) return null;

    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(config)
            .connect()
            .then(pool => {
                console.log('Connected to MSSQL (RMS)');
                return pool;
            })
            .catch(err => {
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

/**
 * Get ALL variants for a given Style ID
 */
async function getVariantsByStyle(styleId) {
    const config = await getConfig();
    if (config.server === 'simulation') {
        return mockInventory.filter(i => i.StyleID === styleId);
    }

    try {
        const pool = await getPool();
        if (!pool) return [];
        // Real RMS Query (Hypothetical schema: Item.StyleID or similar grouping)
        // Adjust query to fit actual schema if known. Assuming 'StyleID' field or similar.
        const result = await pool.request()
            .input('style', sql.NVarChar, styleId)
            .query('SELECT ItemLookupCode, Quantity, Description, Price, LastUpdated, StyleID FROM Item WHERE StyleID = @style');

        return result.recordset;
    } catch (e) {
        console.error("RMS getVariantsByStyle error:", e.message);
        return [];
    }
}

/**
 * Get item details by SKU
 */
async function getItemBySku(sku) {
    const config = await getConfig();
    if (config.server === 'simulation') {
        return mockInventory.find(i => i.ItemLookupCode === sku) || null;
    }

    try {
        const pool = await getPool();
        if (!pool || pool === 'simulation') return mockInventory.find(i => i.ItemLookupCode === sku) || null; // Fallback

        const result = await pool.request()
            .input('sku', sql.NVarChar, sku)
            .query('SELECT ItemLookupCode, Quantity, Description, Price, LastUpdated FROM Item WHERE ItemLookupCode = @sku');

        return result.recordset[0] || null;
    } catch (err) {
        console.error("RMS getItemBySku error:", err.message);
        return null;
    }
}

/**
 * Update stock quantity
 */
async function updateItemStock(sku, quantity) {
    const config = await getConfig();
    if (config.server === 'simulation') {
        const item = mockInventory.find(i => i.ItemLookupCode === sku);
        if (item) {
            item.Quantity = quantity;
            item.LastUpdated = new Date();
            console.log(`[SIMULATION] Updated ${sku} quantity to ${quantity}`);
            return true;
        }
        return false;
    }

    try {
        const pool = await getPool();
        if (!pool) return false;

        const result = await pool.request()
            .input('sku', sql.NVarChar, sku)
            .input('qty', sql.Float, quantity)
            .query('UPDATE Item SET Quantity = @qty, LastUpdated = GETDATE() WHERE ItemLookupCode = @sku');

        console.log(`RMS updated sku=${sku} to qty=${quantity}`);
        return result.rowsAffected[0] > 0;
    } catch (err) {
        console.error("RMS updateItemStock error:", err.message);
        return false;
    }
}

async function decrementItemStock(sku, qtySold = 1) {
    const config = await getConfig();
    if (config.server === 'simulation') {
        const item = mockInventory.find(i => i.ItemLookupCode === sku);
        if (item) {
            item.Quantity -= qtySold;
            item.LastUpdated = new Date();
            console.log(`[SIMULATION] Decremented ${sku} by ${qtySold}`);
            return true;
        }
        return false;
    }

    try {
        const item = await getItemBySku(sku);
        if (!item) {
            console.error(`RMS decrement failed: SKU ${sku} not found`);
            return false;
        }

        const newQty = item.Quantity - qtySold;
        return await updateItemStock(sku, newQty);

    } catch (err) {
        console.error("RMS decrementItemStock error:", err.message);
        return false;
    }
}

/**
 * Get items updated since a specific JS Date
 * NOTE: Returns STYLES that changed, or individual SKUs that imply a Style change
 */
async function getItemsUpdatedSince(dateObj) {
    const config = await getConfig();
    if (config.server === 'simulation') {
        // Randomly touch ONE VARIANT to simulate sales/stock update
        const now = new Date();
        const randomItem = mockInventory[Math.floor(Math.random() * mockInventory.length)];
        randomItem.LastUpdated = now;
        randomItem.Quantity = Math.max(0, randomItem.Quantity - 1); // Simulate sale

        console.log(`[SIMULATION] Variant ${randomItem.ItemLookupCode} updated (Qty: ${randomItem.Quantity}). Triggering Style Sync.`);

        // Return matching items (Variants) that changed
        // SyncEngine will need to deduce StyleID from these
        return mockInventory.filter(i => i.LastUpdated > dateObj);
    }

    // For real RMS, usually best to query `Item` and group or just return changed Items and let SyncEngine group them.
    try {
        const pool = await getPool();
        if (!pool || pool === 'simulation') return [];

        const result = await pool.request()
            .input('cutoff', sql.DateTime, dateObj)
            .query('SELECT ItemLookupCode, Quantity, LastUpdated, StyleID, Price, Description FROM Item WHERE LastUpdated > @cutoff');

        return result.recordset;
    } catch (err) {
        return [];
    }
}

module.exports = {
    getItemBySku,
    updateItemStock,
    decrementItemStock,
    getItemsUpdatedSince,
    getVariantsByStyle
};
