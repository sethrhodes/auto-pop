const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, 'database.sqlite'),
    logging: console.log
});

const queryInterface = sequelize.getQueryInterface();

async function migrate() {
    try {
        await queryInterface.addColumn('Products', 'variants', {
            type: DataTypes.TEXT,
            allowNull: true
        });
        console.log("Added 'variants' column to Products table.");
    } catch (e) {
        console.error("Migration failed (Column might already exist):", e.message);
    }
}

migrate();
