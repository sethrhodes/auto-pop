const { Sequelize } = require('./backend/node_modules/sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'backend', 'database.sqlite'),
    logging: console.log
});

async function migrate() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');

        try {
            await sequelize.query('ALTER TABLE Products ADD COLUMN description TEXT;');
            console.log('Added description column.');
        } catch (e) {
            console.log('description column might already exist:', e.message);
        }

        try {
            await sequelize.query('ALTER TABLE Products ADD COLUMN short_description TEXT;');
            console.log('Added short_description column.');
        } catch (e) {
            console.log('short_description column might already exist:', e.message);
        }

        try {
            await sequelize.query('ALTER TABLE Products ADD COLUMN gallery TEXT;');
            console.log('Added gallery column.');
        } catch (e) {
            console.log('gallery column might already exist:', e.message);
        }

    } catch (error) {
        console.error('Migration failed:', error);
    }
}

migrate();
