const { initDB, User } = require('./database');
const bcrypt = require('bcrypt');

async function reset() {
    try {
        console.log("Connecting to DB...");
        await initDB();

        const email = 'sethdrhodes@gmail.com';
        const password = 'password123';
        const hash = await bcrypt.hash(password, 10);

        console.log(`Resetting password for ${email}...`);

        const [user, created] = await User.findOrCreate({
            where: { email },
            defaults: { password_hash: hash }
        });

        if (!created) {
            user.password_hash = hash;
            await user.save();
            console.log(`\nSUCCESS: Updated existing user.`);
        } else {
            console.log(`\nSUCCESS: Created new user.`);
        }

        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);

    } catch (err) {
        console.error("ERROR:", err);
    } finally {
        process.exit(0);
    }
}

reset();
