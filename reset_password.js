const { initDB, User } = require('./backend/database');
const bcrypt = require('bcrypt');

async function reset() {
    await initDB();
    const email = 'sethdrhodes@gmail.com';
    const password = 'password123';
    const hash = await bcrypt.hash(password, 10);

    const [user, created] = await User.findOrCreate({
        where: { email },
        defaults: { password_hash: hash }
    });

    if (!created) {
        user.password_hash = hash;
        await user.save();
        console.log(`Updated password for ${email}`);
    } else {
        console.log(`Created new user ${email}`);
    }
    console.log(`New Password: ${password}`);
    process.exit(0);
}

reset();
