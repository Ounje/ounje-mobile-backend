const nodemailer = require("nodemailer");
const EmailProvider = require("./EmailProvider");
const logger = require("../../utils/logger");

class NodemailerProvider extends EmailProvider {
    constructor() {
        super();
        this.transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }

    async sendEmail(to, subject, html) {
        try {
            await this.transporter.sendMail({
                from: process.env.EMAIL_USER,
                to,
                subject,
                html,
            });
            logger.info(`Email sent to ${to}`);
            return true;
        } catch (error) {
            logger.error(`Error sending email to ${to}: ${error.message}`);
            return false;
        }
    }
}

module.exports = NodemailerProvider;
