// backend/emailClient.js
require('dotenv').config();
const nodemailer = require('nodemailer');

async function sendWelcomeEmail(email, firstName) {
    console.log(`[EMAIL] Preparing Welcome Email for ${email} (${firstName})...`);

    // Check if SMTP credentials exist
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT || 587,
                secure: false, // true for 465, false for other ports
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            const info = await transporter.sendMail({
                from: '"Auto-Pop Studio" <noreply@autopop.ai>', // sender address
                to: email, // list of receivers
                subject: "Welcome to Auto-Pop Studio!", // Subject line
                text: `Hi ${firstName || 'There'},\n\nWelcome to Auto-Pop Studio! We're excited to help you automate your product workflow.\n\nPlease log in and set up your API keys in the Settings page to get started.\n\nBest,\nThe Auto-Pop Team`, // plain text body
                html: `<p>Hi ${firstName || 'There'},</p><p>Welcome to <b>Auto-Pop Studio</b>! We're excited to help you automate your product workflow.</p><p>Please log in and set up your API keys in the <b>Settings</b> page to get started.</p><br><p>Best,<br>The Auto-Pop Team</p>`, // html body
            });

            console.log(`[EMAIL] Sent: ${info.messageId}`);
            return true;
        } catch (error) {
            console.error("[EMAIL] SMTP Error:", error.message);
            // Don't fail the registration if email fails
            return false;
        }
    } else {
        // Mock Send
        console.log("---------------------------------------------------");
        console.log(`TO: ${email}`);
        console.log(`SUBJECT: Welcome to Auto-Pop Studio!`);
        console.log(`BODY: Hi ${firstName || 'There'}, Welcome to Auto-Pop...`);
        console.log("[EMAIL] (Mock) Email sent successfully.");
        console.log("---------------------------------------------------");
        return true;
    }
}

module.exports = { sendWelcomeEmail };
