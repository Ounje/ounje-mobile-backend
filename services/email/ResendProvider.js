const { Resend } = require("resend");
const EmailProvider = require("./EmailProvider");
const logger = require("../../utils/logger");

class ResendProvider extends EmailProvider {
	constructor() {
		super();

		if (!process.env.RESEND_API_KEY) {
			logger.warn("⚠️ RESEND_API_KEY not found. Email sending will be disabled.");
			this.resend = null;
		} else {
			this.resend = new Resend(process.env.RESEND_API_KEY);
			logger.info("✅ Resend Email Provider initialized");
		}

		// Default sender email
		this.fromEmail = process.env.EMAIL_FROM || "OunjeFood <hello@ounjefood.com>";
	}

	async sendEmail(to, subject, html) {
		if (!this.resend) {
			logger.warn("⚠️ Resend not configured. Skipping email send.");
			return false;
		}

		try {
			const { data, error } = await this.resend.emails.send({
				from: this.fromEmail,
				to: [to],
				subject,
				html,
			});

			if (error) {
				logger.error(`Resend API Error: ${error.message}`);
				return false;
			}

			logger.info(`✅ Email sent to ${to} (ID: ${data.id})`);
			return true;
		} catch (error) {
			logger.error(`Error sending email to ${to}: ${error.message}`);
			return false;
		}
	}

	/**
	 * Send email with attachments (Resend supports this)
	 */
	async sendEmailWithAttachments(to, subject, html, attachments = []) {
		if (!this.resend) {
			logger.warn(" Resend not configured. Skipping email send.");
			return false;
		}

		try {
			const { data, error } = await this.resend.emails.send({
				from: this.fromEmail,
				to: [to],
				subject,
				html,
				attachments, // Format: [{ filename: 'invoice.pdf', content: Buffer }]
			});

			if (error) {
				logger.error(`Resend API Error: ${error.message}`);
				return false;
			}

			logger.info(`✅ Email with attachments sent to ${to} (ID: ${data.id})`);
			return true;
		} catch (error) {
			logger.error(`Error sending email with attachments to ${to}: ${error.message}`);
			return false;
		}
	}

	/**
	 * Send batch emails (up to 100 recipients)
	 */
	async sendBatchEmails(emails) {
		if (!this.resend) {
			logger.warn("⚠️ Resend not configured. Skipping batch email send.");
			return false;
		}

		try {
			const emailData = emails.map((email) => ({
				from: this.fromEmail,
				to: [email.to],
				subject: email.subject,
				html: email.html,
			}));

			const { data, error } = await this.resend.batch.send(emailData);

			if (error) {
				logger.error(`Resend Batch API Error: ${error.message}`);
				return false;
			}

			logger.info(` Batch emails sent to ${emails.length} recipients`);
			return true;
		} catch (error) {
			logger.error(`Error sending batch emails: ${error.message}`);
			return false;
		}
	}
}

module.exports = ResendProvider;
