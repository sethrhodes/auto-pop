// backend/database.js
const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Initialize SQLite DB
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database.sqlite'),
    logging: false // Disable console logging for cleaner output
});

// --- MODELS ---

const User = sequelize.define('User', {
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password_hash: {
        type: DataTypes.STRING,
        allowNull: false
    },
    first_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    last_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    company_name: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

const UserSettings = sequelize.define('UserSettings', {
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    key_name: {
        type: DataTypes.STRING, // e.g. OPENAI_API_KEY
        allowNull: false
    },
    key_value: {
        type: DataTypes.TEXT, // Encrypted value
        allowNull: false
    },
    iv: {
        type: DataTypes.STRING, // Initialization Vector for encryption
        allowNull: false
    }
});

// Product History Model
const Product = sequelize.define('Product', {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    sku: { type: DataTypes.STRING, allowNull: true },
    price: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    short_description: { type: DataTypes.TEXT, allowNull: true },
    gallery: { type: DataTypes.TEXT, allowNull: true }, // JSON string of gallery objects
    status: { type: DataTypes.STRING, defaultValue: 'draft' }, // 'draft', 'published'
    image_url: { type: DataTypes.STRING, allowNull: true }, // Main image
    remote_id: { type: DataTypes.STRING, allowNull: true }, // WooCommerce ID
    variants: { type: DataTypes.TEXT, allowNull: true }, // JSON: [{ sku, size, color, qty, price }]
    front_image: { type: DataTypes.STRING, allowNull: true }, // Original Filename
    back_image: { type: DataTypes.STRING, allowNull: true }, // Original Filename
    gender: { type: DataTypes.STRING, allowNull: true }, // 'men', 'women', 'kids'
    category: { type: DataTypes.STRING, allowNull: true }, // 'top', 'bottom'
    is_hooded: { type: DataTypes.BOOLEAN, allowNull: true } // true/false
});


// Relationships
User.hasMany(UserSettings, { foreignKey: 'user_id' });
UserSettings.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Product, { foreignKey: 'user_id' });
Product.belongsTo(User, { foreignKey: 'user_id' });


// --- ENCRYPTION HELPERS ---
// We need a stable secret for encryption. 
// Fallback to a hardcoded string if env var missing (DEV ONLY), generally bad practice but ok for MVP local tool.
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'dev_secret_key_32_bytes_long_string!!';
// Ensure key is 32 bytes
const ALGORITHM = 'aes-256-cbc';

function getCryptoKey() {
    return crypto.scryptSync(ENCRYPTION_SECRET, 'salt', 32);
}

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getCryptoKey(), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return {
        iv: iv.toString('hex'),
        content: encrypted.toString('hex')
    };
}

function decrypt(hash) {
    const iv = Buffer.from(hash.iv, 'hex');
    const encryptedText = Buffer.from(hash.content, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getCryptoKey(), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}


// --- INIT FUNCTION ---
async function initDB() {
    try {
        await sequelize.authenticate();
        await sequelize.sync({ alter: true }); // Create or Update tables
        console.log('Database connected and synced.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
}

module.exports = {
    sequelize,
    User,
    UserSettings,
    Product, // Added
    initDB,
    encrypt,
    decrypt
};
