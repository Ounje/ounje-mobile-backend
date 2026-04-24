const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Webhooks
 *   description: External Webhooks
 */

/**
 * @swagger
 * /api/webhooks/paystack:
 *   post:
 *     summary: Paystack Webhook
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/paystack", express.json({ type: "*/*" }), async (req, res) => {
	const hash = crypto
		.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
		.update(req.rawBody ?? JSON.stringify(req.body))
		.digest("hex");

	// Always respond 200 immediately so Paystack doesn't retry
	res.sendStatus(200);

	if (hash !== req.headers["x-paystack-signature"]) return;

	const event = req.body;

	console.log(
		`[Webhook] event=${event.event} channel=${event.data?.channel} amount=${event.data?.amount} customer_code=${event.data?.customer?.customer_code} ref=${event.data?.reference}`,
	);

	if (
		event.event === "charge.success" &&
		event.data?.channel === "dedicated_nuban"
	) {
		const data = event.data;
		const customerCode = data.customer?.customer_code;
		const reference = data.reference;
		const amountNaira = data.amount / 100;

		try {
			const { Customer, LedgerEntry, LedgerAccount } = require("../models");
			const ledgerService = require("../services/ledger.service");
			const notificationService = require("../services/notification.service");

			const customer = await Customer.findOne({
				paystackCustomerCode: customerCode,
			});
			console.log(
				`[Webhook] customer lookup: code=${customerCode} found=${!!customer} id=${customer?._id}`,
			);

			if (!customer) {
				console.error(`[Webhook] no customer matched paystackCustomerCode=${customerCode}`);
				return;
			}

			// Idempotency: skip if we already credited this Paystack reference
			const account = await LedgerAccount.findOne({
				userId: customer._id,
				type: "CUSTOMER",
			});
			console.log(`[Webhook] ledger account found=${!!account}`);

			if (account) {
				const already = await LedgerEntry.findOne({
					accountId: account._id,
					"meta.paystackReference": reference,
				});
				if (already) {
					console.log(`[Webhook] already processed reference=${reference} — skipping`);
					return;
				}
			}

			await ledgerService.creditAccount(
				customer._id,
				"CUSTOMER",
				amountNaira,
				"DVA_TRANSFER",
				null,
				{ paystackReference: reference, channel: data.channel },
			);

			console.log(`[Webhook] credited ₦${amountNaira} to customer=${customer._id}`);

			try {
				const emailService = require("../services/email/EmailService");
				const populatedCustomer = await customer.populate("user");

				if (populatedCustomer.user?.email) {
					await emailService.transferSuccessEmail(
						populatedCustomer.user.email,
						populatedCustomer.firstName,
						`₦${amountNaira.toLocaleString()}`,
						populatedCustomer.titanAccount?.accountNumber,
					);
				}
			} catch (emailErr) {
				console.error(`[Webhook] Transfer success email failed: ${emailErr.message}`);
			}

			console.log(`[PushDebug] calling notifyCustomerWalletTopup for customer=${customer._id}`);
			await notificationService.notifyCustomerWalletTopup(customer._id, amountNaira);
			console.log(`[PushDebug] notifyCustomerWalletTopup returned`);
		} catch (err) {
			console.error("[Webhook] DVA top-up error:", err.message);
		}
	}
});

module.exports = router;
