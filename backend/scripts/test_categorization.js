require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { resolveCategories, getWooClient } = require('../wooClient');

// We need to access getWooClient but it is not exported. 
// Actually, resolveCategories takes 'api' as first arg.
// I need 'getWooClient' to create the 'api' instance.
// I'll assume getWooClient is NOT exported (I checked, it wasn't).
// I will check wooClient.js again or just duplicate the axios creation logic here if needed.
// Wait, I can just modify wooClient.js to export getWooClient too.

// BUT, let's look at the file. `getWooClient` IS defined.
// I'll modify wooClient.js to export `getWooClient` as well in the previous step? 
// Actually I missed that. I'll do it now or just rely on `createProduct` logic? 
// No, I want isolation.
// I'll rely on the `replace_file_content` I just did? No, I only exported resolveCategories.
// I will assume I can update the file again to export getWooClient or just copy the logic. 
// Copying logic is safer to avoid multiple edits to the same file in one turn (although sequential is fine).

const axios = require("axios");
const https = require("https");

const agent = new https.Agent({
    rejectUnauthorized: false,
});

function getClient() {
    let baseURL = process.env.WC_BASE_URL;
    if (baseURL) {
        if (!baseURL.startsWith("http")) baseURL = `https://${baseURL}`;
        if (baseURL.endsWith("/")) baseURL = baseURL.slice(0, -1);
        if (!baseURL.includes("/wp-json")) baseURL += "/wp-json/wc/v3";
    }
    const consumerKey = process.env.WC_CONSUMER_KEY;
    const consumerSecret = process.env.WC_CONSUMER_SECRET;

    if (!baseURL || !consumerKey || !consumerSecret) {
        console.error("Missing keys:", { baseURL, consumerKey: !!consumerKey });
        process.exit(1);
    }

    return axios.create({
        baseURL,
        auth: { username: consumerKey, password: consumerSecret },
        httpsAgent: agent
    });
}

async function runTest() {
    const api = getClient();
    console.log("Testing Categorization Logic...");

    console.log("\n--- Test 1: Men + Hoodie ---");
    const cat1 = await resolveCategories(api, { gender: 'men', category: 'top', isHooded: true, name: 'Test Hoodie' });
    console.log("Result 1:", JSON.stringify(cat1, null, 2));

    console.log("\n--- Test 2: Women + Hat ---");
    const cat2 = await resolveCategories(api, { gender: 'women', category: 'hat', isHooded: false, name: 'Test Hat' });
    console.log("Result 2:", JSON.stringify(cat2, null, 2));

    console.log("\n--- Test 3: Kids + Tee ---");
    const cat3 = await resolveCategories(api, { gender: 'kids', category: 'top', isHooded: false, name: 'Test Tee' });
    console.log("Result 3:", JSON.stringify(cat3, null, 2));
}

runTest();
