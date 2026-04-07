const { Resend } = require("resend");
const EmailProvider = require("./EmailProvider");
const logger = require("../../utils/logger");

class ResendProvider extends EmailProvider {
    constructor() {
        super();
        this.resend = new Resend(process.env.RESEND_API_KEY);
        this.fromAddress = process.env.EMAIL_FROM || "OunjeFood <noreply@yourdomain.com>";
    }

    async sendEmail(to, subject, html) {
        try {
            await this.resend.emails.send({
                from: this.fromAddress,
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

module.exports = ResendProvider;
