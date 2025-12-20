// backend/auth.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { User, UserSettings, encrypt, decrypt } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_key_123';

// --- MIDDLEWARE ---

/**
 * Verify JWT Token
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401); // Unauthorized

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Forbidden
        req.user = user;
        next();
    });
}

/**
 * Load User API Keys and attach to req.userKeys
 * Falls back to process.env if key is missing/empty for the user
 */
async function loadUserKeys(req, res, next) {
    if (!req.user) return next();

    try {
        const settings = await UserSettings.findAll({ where: { user_id: req.user.id } });
        const userKeys = {};

        // Decrypt user keys
        settings.forEach(setting => {
            try {
                const decrypted = decrypt({
                    iv: setting.iv,
                    content: setting.key_value
                });
                userKeys[setting.key_name] = decrypted;
            } catch (e) {
                console.error(`Failed to decrypt key ${setting.key_name} for user ${req.user.id}`);
            }
        });

        // Merge with Env Defaults (User keys override Env keys? Or Env overrides User? 
        // User keys should override Env to allow personalization. 
        // If User key is missing, fall back to Env.)

        req.userKeys = {
            OPENAI_API_KEY: userKeys.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
            IMAGE_API_KEY: userKeys.IMAGE_API_KEY || process.env.IMAGE_API_KEY,
            OCR_API_KEY: userKeys.OCR_API_KEY || process.env.OCR_API_KEY, // Added this
            WC_BASE_URL: userKeys.WC_BASE_URL || process.env.WC_BASE_URL,
            WC_CONSUMER_KEY: userKeys.WC_CONSUMER_KEY || process.env.WC_CONSUMER_KEY,
            WC_CONSUMER_SECRET: userKeys.WC_CONSUMER_SECRET || process.env.WC_CONSUMER_SECRET,
            RMS_HOST: userKeys.RMS_HOST || process.env.RMS_HOST,
            RMS_USER: userKeys.RMS_USER || process.env.RMS_USER,
            RMS_PASSWORD: userKeys.RMS_PASSWORD || process.env.RMS_PASSWORD,
            RMS_DATABASE: userKeys.RMS_DATABASE || process.env.RMS_DATABASE,
        };

        next();
    } catch (err) {
        console.error("Error loading user keys:", err);
        next();
    }
}


// --- CONTROLLERS ---

async function register(req, res) {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).send('Email and Password required');

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ email, password_hash: hashedPassword });

        res.status(201).json({ message: 'User created' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function login(req, res) {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ where: { email } });

        if (!user) return res.status(400).send('Cannot find user');

        if (await bcrypt.compare(password, user.password_hash)) {
            const accessToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
            res.json({ accessToken, user: { id: user.id, email: user.email } });
        } else {
            res.status(403).send('Not Allowed');
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function getSettings(req, res) {
    try {
        const settings = await UserSettings.findAll({ where: { user_id: req.user.id } });
        // Return masked keys
        const masked = settings.map(s => ({
            key_name: s.key_name,
            set: true // Don't return actual key
        }));
        res.json(masked);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function updateSettings(req, res) {
    try {
        const { keys } = req.body; // { OPENAI_API_KEY: "sk-...", ... }

        for (const [keyName, keyValue] of Object.entries(keys)) {
            if (!keyValue) continue; // Skip empty updates

            const encrypted = encrypt(keyValue);

            // Upsert
            const existing = await UserSettings.findOne({
                where: { user_id: req.user.id, key_name: keyName }
            });

            if (existing) {
                existing.key_value = encrypted.content;
                existing.iv = encrypted.iv;
                await existing.save();
            } else {
                await UserSettings.create({
                    user_id: req.user.id,
                    key_name: keyName,
                    key_value: encrypted.content,
                    iv: encrypted.iv
                });
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    authenticateToken,
    loadUserKeys,
    register,
    login,
    getSettings,
    updateSettings
};
