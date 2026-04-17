const fs = require("fs").promises;
const path = require("path");
const ResendProvider = require("./ResendProvider");

class EmailService {
	constructor(provider) {
		this.provider = provider || new ResendProvider();
	}

	/**
	 * Load and populate email template
	 */
	async loadTemplate(templateName, replacements) {
		try {
			const templatePath = path.join(
				__dirname,
				"../../templates",
				templateName,
			);
			let html = await fs.readFile(templatePath, "utf-8");

			for (const [key, value] of Object.entries(replacements)) {
				html = html.replace(new RegExp(`{{${key}}}`, "g"), value);
			}

			return html;
		} catch (error) {
			console.error(`Error loading template ${templateName}:`, error);
			throw new Error("Template loading failed");
		}
	}

	/**
	 * Send welcome email to new users
	 */
	async sendWelcomeEmail(email, name) {
		const html = await this.loadTemplate("welcome-email.html", { name });
		return this.provider.sendEmail(
			email,
			"Welcome to OunjeFood - Eat Fresh, Spend Less, Order Fast!",
			html,
		);
	}

	/**
	 * Send OTP verification email
	 */
	async sendOtpEmail(email, otp, purpose = "verification") {
		const otpDigits = otp.split("");
		const replacements = {
			otp_1: otpDigits[0] || "0",
			otp_2: otpDigits[1] || "0",
			otp_3: otpDigits[2] || "0",
			otp_4: otpDigits[3] || "0",
		};

		const html = await this.loadTemplate("otp.html", replacements);
		const subject =
			purpose === "login"
				? "Your OunjeFood Login Code"
				: "Verify Your OunjeFood Email";

		return this.provider.sendEmail(email, subject, html);
	}

	/**
	 * Send order confirmation email
	 */
	async sendOrderConfirmationEmail(email, orderDetails) {
		const replacements = {
			customerName: orderDetails.customerName,
			orderNumber: orderDetails.orderNumber,
			totalAmount: orderDetails.totalAmount,
			orderDate: orderDetails.orderDate,
			items: orderDetails.items, // This might need special formatting in template
		};

		const html = await this.loadTemplate(
			"order-confirmation.html",
			replacements,
		);
		return this.provider.sendEmail(
			email,
			`Order Confirmation - ${orderDetails.orderNumber}`,
			html,
		);
	}

	/**
	 * Send password reset email
	 */
	async sendPasswordResetEmail(email, resetLink, name) {
		const replacements = {
			name,
			resetLink,
		};

		const html = await this.loadTemplate("password-reset.html", replacements);
		return this.provider.sendEmail(
			email,
			"Reset Your OunjeFood Password",
			html,
		);
	}

	/**
	 * Send order status update email
	 */
	async sendOrderStatusEmail(email, orderNumber, status, customerName) {
		const replacements = {
			customerName,
			orderNumber,
			status,
		};

		const html = await this.loadTemplate("order-status.html", replacements);
		return this.provider.sendEmail(
			email,
			`Order ${orderNumber} - ${status}`,
			html,
		);
	}

	/**
	 * Send vendor payout notification email
	 */
	async sendPayoutNotificationEmail(email, vendorName, amount, date) {
		const replacements = {
			vendorName,
			amount,
			date,
		};

		const html = await this.loadTemplate(
			"payout-notification.html",
			replacements,
		);
		return this.provider.sendEmail(
			email,
			`Payout Processed - ₦${amount}`,
			html,
		);
	}

	/**
	 * Send newsflash email to vendors
	 */
	async sendNewsFlashEmail(email, vendorName, title, content) {
		const replacements = {
			vendorName,
			title,
			content,
		};

		const html = await this.loadTemplate("newsflash.html", replacements);
		return this.provider.sendEmail(email, `📢 ${title}`, html);
	}

	/**
	 * Send batch emails (for announcements, newsletters, etc.)
	 */
	async sendBatchEmails(emails) {
		if (this.provider.sendBatchEmails) {
			return this.provider.sendBatchEmails(emails);
		} else {
			// Fallback to sequential sending if batch not supported
			const results = await Promise.allSettled(
				emails.map((email) =>
					this.provider.sendEmail(email.to, email.subject, email.html),
				),
			);
			return results.every((result) => result.status === "fulfilled");
		}
	}
}

module.exports = new EmailService();
