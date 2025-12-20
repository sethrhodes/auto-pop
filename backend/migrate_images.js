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
        await queryInterface.addColumn('Products', 'front_image', {
            type: DataTypes.STRING,
            allowNull: true
        });
        console.log("Added 'front_image' to Products.");
    } catch (e) {
        console.log("front_image update skipped:", e.message);
    }

    try {
        await queryInterface.addColumn('Products', 'back_image', {
            type: DataTypes.STRING,
            allowNull: true
        });
        console.log("Added 'back_image' to Products.");
    } catch (e) {
        console.log("back_image update skipped:", e.message);
    }
}

migrate();
