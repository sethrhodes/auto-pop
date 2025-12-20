// backend/syncEngine.js
const rms = require('./rmsClient');
const woo = require('./wooClient');
const { Product } = require('./database');

let isRunning = false;
let lastSyncTime = new Date();
// Start tracking from 1 hour ago to catch recent changes on boot
lastSyncTime.setMinutes(lastSyncTime.getMinutes() - 60);

// Polling Interval (30s for faster testing feedback)
const POLL_INTERVAL_MS = 30 * 1000;

async function syncRmsToWeb() {
    if (isRunning) {
        console.log("Sync already running, skipping...");
        return;
    }
    isRunning = true;
    console.log("Starting RMS -> Web Sync...");

    try {
        const changes = await rms.getItemsUpdatedSince(lastSyncTime);
        console.log(`Found ${changes.length} changed items in RMS.`);

        if (changes.length > 0) {
            let maxTime = lastSyncTime;

            // 1. Identify Unique Styles that changed
            // In simulation, we get Variants, which have StyleID.
            // In real world, we might get an Item that has a StyleID column.
            const styleIdsToSync = new Set();
            for (const item of changes) {
                // 1. Try to deduce Style ID from convention (Suffix stripping)
                // This takes priority as per user request
                let deducedStyle = rms.extractStyleFromSku(item.ItemLookupCode);

                if (deducedStyle) {
                    styleIdsToSync.add(deducedStyle);
                } else if (item.StyleID) {
                    styleIdsToSync.add(item.StyleID);
                } else if (item.ItemLookupCode) {
                    styleIdsToSync.add(item.ItemLookupCode);
                }

                if (item.LastUpdated > maxTime) {
                    maxTime = item.LastUpdated;
                }
            }

            console.log(`[SYNC] Found ${styleIdsToSync.size} unique styles to update.`);

            // 2. Sync Each Style
            for (const styleId of styleIdsToSync) {
                try {
                    // Fetch ALL variants for this style (to ensure we have the full size run)
                    const variants = await rms.getVariantsByStyle(styleId);

                    if (!variants || variants.length === 0) {
                        // Fallback? If we can't find variants by StyleID, maybe it was a single item.
                        // Or just skip.
                        console.warn(`[SYNC] No variants found for Style ${styleId}`);
                        continue;
                    }

                    // Map RMS variants to our schema
                    const variantData = variants.map(v => ({
                        sku: v.ItemLookupCode,
                        size: v.Description.match(/\((.*?)\)/)?.[1] || 'Standard', // Simple parser for now
                        qty: v.Quantity,
                        price: v.Price
                    }));

                    // calculate total qty
                    const totalQty = variants.reduce((sum, v) => sum + v.Quantity, 0);
                    const mainVariant = variants[0]; // Use first for generic info

                    // Upsert Product (Parent)
                    const existing = await Product.findOne({ where: { sku: styleId, user_id: 1 } }); // Use StyleID as Parent SKU

                    if (existing) {
                        console.log(`[SYNC] Updating Style ${styleId} (${variants.length} variants)`);
                        await existing.update({
                            variants: JSON.stringify(variantData),
                            // Update total stock or price?
                            // Maybe denote it's a variable product?
                        });
                    } else {
                        console.log(`[SYNC] Creating New Style ${styleId}`);
                        await Product.create({
                            user_id: 1,
                            name: mainVariant.Description.split('(')[0].trim() || "Imported Style", // Clean name
                            sku: styleId, // Parent SKU is the Style ID
                            price: mainVariant.Price?.toString() || "0.00",
                            description: `Imported Style: ${styleId}. Contains ${variants.length} variants.`,
                            status: 'draft',
                            image_url: 'https://via.placeholder.com/400?text=Pending+Photo',
                            gallery: '[]',
                            variants: JSON.stringify(variantData)
                        });
                    }
                } catch (err) {
                    console.error(`[SYNC] Failed to process Style ${styleId}`, err.message);
                }
            }

            lastSyncTime = maxTime;
        }

    } catch (err) {
        console.error("Sync Cycle Error:", err.message);
    } finally {
        isRunning = false;
    }
}

function startPolling() {
    // Initial Run
    syncRmsToWeb();
    // Loop
    // setInterval(syncRmsToWeb, POLL_INTERVAL_MS);
    console.log("RMS Sync Polling DISABLED for debugging.");
}

/**
 * Handle Web Order (Webhook)
 */
async function handleWebOrderCreated(orderData) {
    console.log("Received Web Order:", orderData.id);

    if (!orderData.line_items) return;

    for (const line of orderData.line_items) {
        const sku = line.sku;
        const qty = line.quantity;

        if (sku) {
            console.log(`Web Store sold ${qty} x ${sku}. Updating RMS...`);
            await rms.decrementItemStock(sku, qty);
        } else {
            console.warn("Order line item missing SKU, skipping RMS sync.");
        }
    }
}

module.exports = {
    startPolling,
    handleWebOrderCreated
};
