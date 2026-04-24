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
		.update(JSON.stringify(req.body))
		.digest("hex");

	// Always respond 200 immediately so Paystack doesn't retry
	res.sendStatus(200);

	if (hash !== req.headers["x-paystack-signature"]) return;

	const event = req.body;

	if (event.event === "charge.success" && event.data?.channel === "dedicated_nuban") {
		const data = event.data;
		const customerCode = data.customer?.customer_code;
		const reference = data.reference;
		const amountNaira = data.amount / 100;

		try {
			const { Customer, LedgerEntry, LedgerAccount } = require("../models");
			const ledgerService = require("../services/ledger.service");
			const notificationService = require("../services/notification.service");

			const customer = await Customer.findOne({ paystackCustomerCode: customerCode });
			if (!customer) {
				console.error(`[Webhook] DVA top-up: no customer found for code ${customerCode}`);
				return;
			}

			// Idempotency: skip if we already credited this Paystack reference
			const account = await LedgerAccount.findOne({ userId: customer._id, type: "CUSTOMER" });
			if (account) {
				const already = await LedgerEntry.findOne({
					accountId: account._id,
					"meta.paystackReference": reference,
				});
				if (already) {
					console.log(`[Webhook] DVA top-up: already processed reference ${reference}`);
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

			await notificationService.notifyCustomerWalletTopup(customer._id, amountNaira);

			console.log(`[Webhook] DVA top-up: credited ₦${amountNaira} to customer ${customer._id} (ref: ${reference})`);
		} catch (err) {
			console.error("[Webhook] DVA top-up error:", err.message);
		}
	}
});

module.exports = router;
