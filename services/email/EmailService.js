const fs = require("fs").promises;
const path = require("path");
const ResendProvider = require("./ResendProvider");

// ── Order confirmation helpers ────────────────────────────────────────────────
const _ITEM_EMOJI = { FoodItem: "🍛", Combo: "🍱", Plate: "🍽️" };
const _fmtNaira = (n) => `₦${Number(n).toLocaleString("en-NG")}`;

const _buildOrderItemsHtml = (items = []) =>
	items
		.map((item) => {
			const emoji = _ITEM_EMOJI[item.itemType] ?? "🍲";
			const lineTotal = _fmtNaira(item.price * item.quantity);
			const noteRow = item.notes?.trim()
				? `<tr><td colspan="2" style="padding:0 0 8px 52px;font-size:12px;color:#5c5c5c;font-style:italic;">"${item.notes.trim()}"</td></tr>`
				: "";
			return `
			<tr>
				<td style="padding:8px 0;">
					<table cellpadding="0" cellspacing="0" role="presentation"><tr>
						<td style="width:40px;height:40px;background:#e6f9e7;border-radius:10px;text-align:center;font-size:20px;line-height:40px;">${emoji}</td>
						<td style="padding-left:12px;font-size:13.5px;color:#2c2c2c;">${item.name} &nbsp;×&nbsp; ${item.quantity}</td>
					</tr></table>
				</td>
				<td align="right" style="font-size:13.5px;font-weight:700;color:#111111;padding:8px 0;">${lineTotal}</td>
			</tr>${noteRow}`;
		})
		.join("");

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
	 * Send Profile Change confirmation OTP verification email
	 */
	async sendProfileChangeConfirmationEmailOtp(
		email,
		otp,
		purpose = "verification",
	) {
		const otpDigits = otp.split("");
		const replacements = {
			otp_1: otpDigits[0] || "0",
			otp_2: otpDigits[1] || "0",
			otp_3: otpDigits[2] || "0",
			otp_4: otpDigits[3] || "0",
		};

		const html = await this.loadTemplate(
			"profile-change-otp.html",
			replacements,
		);
		const subject =
			purpose === "Verification"
				? "Your OunjeFood Profile Change Code"
				: "Verify Your OunjeFood Profile Change";

		return this.provider.sendEmail(email, subject, html);
	}

	/**
	 * Send transfer success email to a customer
	 * @param {string}       email
	 * @param {string}       name          - customer.firstName
	 * @param {string}       amount        - formatted transfer amount e.g. "₦5,000"
	 * @param {string}       accountNumber - titan virtual account number
	 */
	async transferSuccessEmail(email, name, amount, accountNumber) {
		const replacements = {
			name,
			amount,
			accountNumber,
		};

		const html = await this.loadTemplate(
			"customer-transfer.html",
			replacements,
		);

		return this.provider.sendEmail(
			email,
			"Your OunjeFood Wallet Has Been Credited – Transfer Successful",
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
	 * Send order confirmation email
	 * @param {string}   email
	 * @param {Object}   orderDetails
	 * @param {string}   orderDetails.customerName
	 * @param {string}   orderDetails.orderNumber    - order.orderNumber
	 * @param {string}   orderDetails.status         - order.status
	 * @param {string}   orderDetails.vendorName     - vendor.storeName
	 * @param {string}   orderDetails.paymentMethod  - order.paymentMethod
	 * @param {string}   orderDetails.paymentStatus  - order.paymentStatus
	 * @param {string}   orderDetails.orderDate      - formatted order.createdAt
	 * @param {Array}    orderDetails.items          - order.items[]
	 * @param {number}   orderDetails.foodTotal      - order.foodTotal
	 * @param {number}   orderDetails.deliveryFee    - order.deliveryFee
	 * @param {number}   orderDetails.serviceFee     - order.serviceFee
	 * @param {number}   orderDetails.totalPrice     - order.totalPrice
	 * @param {string}   orderDetails.deliveryAddress
	 * @param {string}   orderDetails.deliveryZone   - order.zone
	 */
	async sendOrderConfirmationEmail(email, orderDetails) {
		const replacements = {
			name: orderDetails.customerName,
			order_number: orderDetails.orderNumber,
			status: orderDetails.status,
			vendor_name: orderDetails.vendorName,
			payment_method: orderDetails.paymentMethod,
			payment_status: orderDetails.paymentStatus,
			order_date: orderDetails.orderDate,
			items_html: _buildOrderItemsHtml(orderDetails.items),
			customer_note:
				orderDetails.items.find((i) => i.notes?.trim())?.notes ?? "",
			food_total: _fmtNaira(orderDetails.foodTotal),
			delivery_fee: _fmtNaira(orderDetails.deliveryFee),
			service_fee: _fmtNaira(orderDetails.serviceFee),
			total_amount: _fmtNaira(orderDetails.totalPrice),
			delivery_address: orderDetails.deliveryAddress,
			delivery_zone: orderDetails.deliveryZone,
		};

		const html = await this.loadTemplate("normal-receipt.html", replacements);

		return this.provider.sendEmail(
			email,
			`Order Confirmed — ${orderDetails.orderNumber}`,
			html,
		);
	}
	/**
	 * Send first order confirmation email
	 * @param {string}   email
	 * @param {Object}   orderDetails        - same shape as sendOrderConfirmationEmail
	 * @param {string}   orderDetails.customerName
	 * @param {string}   orderDetails.orderNumber    - order.orderNumber
	 * @param {string}   orderDetails.status         - order.status
	 * @param {string}   orderDetails.vendorName     - vendor.storeName
	 * @param {string}   orderDetails.paymentMethod  - order.paymentMethod
	 * @param {string}   orderDetails.paymentStatus  - order.paymentStatus
	 * @param {string}   orderDetails.orderDate      - formatted order.createdAt
	 * @param {Array}    orderDetails.items          - order.items[]
	 * @param {number}   orderDetails.foodTotal      - order.foodTotal
	 * @param {number}   orderDetails.deliveryFee    - order.deliveryFee
	 * @param {number}   orderDetails.serviceFee     - order.serviceFee
	 * @param {number}   orderDetails.totalPrice     - order.totalPrice
	 * @param {string}   orderDetails.deliveryAddress
	 * @param {string}   orderDetails.deliveryZone   - order.zone
	 */
	async sendFirstOrderConfirmationEmail(email, orderDetails) {
		const replacements = {
			name: orderDetails.customerName,
			order_number: orderDetails.orderNumber,
			status: orderDetails.status,
			vendor_name: orderDetails.vendorName,
			payment_method: orderDetails.paymentMethod,
			payment_status: orderDetails.paymentStatus,
			order_date: orderDetails.orderDate,
			items_html: _buildOrderItemsHtml(orderDetails.items),
			customer_note:
				orderDetails.items.find((i) => i.notes?.trim())?.notes ?? "",
			food_total: _fmtNaira(orderDetails.foodTotal),
			delivery_fee: _fmtNaira(orderDetails.deliveryFee),
			service_fee: _fmtNaira(orderDetails.serviceFee),
			total_amount: _fmtNaira(orderDetails.totalPrice),
			delivery_address: orderDetails.deliveryAddress,
			delivery_zone: orderDetails.deliveryZone,
		};

		const html = await this.loadTemplate("first-order.html", replacements);

		return this.provider.sendEmail(
			email,
			`Welcome to OunjeFood — Your First Order is Confirmed! 🎉`,
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
	 * Send 10th order milestone email
	 * @param {string}   email
	 * @param {Object}   orderDetails        - same shape as sendOrderConfirmationEmail
	 * @param {string}   orderDetails.customerName
	 * @param {string}   orderDetails.orderNumber    - order.orderNumber
	 * @param {string}   orderDetails.status         - order.status
	 * @param {string}   orderDetails.vendorName     - vendor.storeName
	 * @param {string}   orderDetails.paymentMethod  - order.paymentMethod
	 * @param {string}   orderDetails.paymentStatus  - order.paymentStatus
	 * @param {string}   orderDetails.orderDate      - formatted order.createdAt
	 * @param {Array}    orderDetails.items          - order.items[]
	 * @param {number}   orderDetails.foodTotal      - order.foodTotal
	 * @param {number}   orderDetails.deliveryFee    - order.deliveryFee
	 * @param {number}   orderDetails.serviceFee     - order.serviceFee
	 * @param {number}   orderDetails.totalPrice     - order.totalPrice
	 * @param {string}   orderDetails.deliveryAddress
	 * @param {string}   orderDetails.deliveryZone   - order.zone
	 */
	async sendTenthOrderEmail(email, orderDetails) {
		const replacements = {
			name: orderDetails.customerName,
			order_number: orderDetails.orderNumber,
			status: orderDetails.status,
			vendor_name: orderDetails.vendorName,
			payment_method: orderDetails.paymentMethod,
			payment_status: orderDetails.paymentStatus,
			order_date: orderDetails.orderDate,
			items_html: _buildOrderItemsHtml(orderDetails.items),
			customer_note:
				orderDetails.items.find((i) => i.notes?.trim())?.notes ?? "",
			food_total: _fmtNaira(orderDetails.foodTotal),
			delivery_fee: _fmtNaira(orderDetails.deliveryFee),
			service_fee: _fmtNaira(orderDetails.serviceFee),
			total_amount: _fmtNaira(orderDetails.totalPrice),
			delivery_address: orderDetails.deliveryAddress,
			delivery_zone: orderDetails.deliveryZone,
		};

		const html = await this.loadTemplate("ten-orders.html", replacements);

		return this.provider.sendEmail(
			email,
			`10 Orders In — You're on a roll! 🎉`,
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
