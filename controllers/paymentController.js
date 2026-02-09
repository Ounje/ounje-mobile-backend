const axios = require("axios");
const { Payment, Customer, Order } = require("../models");
const crypto = require("crypto");
const ledgerService = require("../services/ledger.service");
const payoutService = require("../services/payout.service");

const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
});

/**
 * 1. Initialize Payment
 * Frontend calls this to get the "authorization_url" to show the Paystack checkout
 */
const initialisePayment = async (req, res) => {
	try {
		const { orderId } = req.body;
		const userId = req.user.id;
		const order = await Order.findById(orderId);
		if (!order) return res.status(400).json({ error: "Order not found" });

		const customer = await Customer.findOne({ user: userId }).populate("user");
		if (!customer) {
			return res.status(400).json({ error: "Customer not found" });
		}

		const email = customer.user ? customer.user.email : null;

		if (!email) {
			return res.status(400).json({ error: "Customer email is required" });
		}

		// Paystack expects amount in KOBO (multiply by 100)
		const amountInKobo = Math.round(order.totalPrice * 100);

		const response = await paystack.post("/transaction/initialize", {
			email: email,
			amount: amountInKobo,
			metadata: {
				orderId: order._id.toString(),
				customerId: customer._id.toString(),
			},
			callback_url: `${process.env.FRONTEND_URL}/payment/verify`, // Where user goes after paying
		});

		// Create a Payment record in your DB as 'pending'
		await Payment.create({
			reference: response.data.data.reference,
			orderId: order._id,
			amount: order.totalPrice,
			customer: customer._id,
			status: "pending",
		});

		return res.status(200).json(response.data);
	} catch (err) {
		console.error("Paystack Init Error:", err.response?.data || err.message);
		res.status(500).json({ error: "Could not initialize payment" });
	}
};

/**
 * 2. Verify Payment
 * Frontend calls this after the user is redirected back to the site
 */
const verifyPayment = async (req, res) => {
	const { reference } = req.query;
	if (!reference) return res.status(400).json({ error: "Missing reference" });

	try {
		const response = await paystack.get(`/transaction/verify/${reference}`);
		const data = response.data.data;

		const payment = await Payment.findOne({ reference });
		if (!payment)
			return res.status(404).json({ error: "Payment record not found" });

		if (data.status === "success") {
			payment.status = "success";
			payment.paidAt = data.paid_at;
			await payment.save();

			// Update Order Status
			await Order.findByIdAndUpdate(payment.orderId, { paymentStatus: "paid" });

			return res.json({
				success: true,
				message: "Payment verified successfully",
				data,
			});
		}

		return res
			.status(400)
			.json({ success: false, message: "Payment was not successful" });
	} catch (err) {
		console.error("Verification Error:", err.response?.data || err.message);
		res.status(500).json({ error: "Payment verification failed" });
	}
};

/**
 * 3. Webhook Handler
 * Paystack calls this directly (Server-to-Server) to finalize the Ledger balances
 */
const webhookHandler = async (req, res) => {
	const secret = process.env.PAYSTACK_TEST_SECRET_KEY;
	const hash = crypto
		.createHmac("sha512", secret)
		.update(JSON.stringify(req.body))
		.digest("hex");

	if (hash != req.headers["x-paystack-signature"]) {
		return res.status(400).send("Invalid signature");
	}

	try {
		const event = req.body;

		if (event.event === "charge.success") {
			const { amount, metadata } = event.data;
			const order = await Order.findById(metadata.orderId).populate("items");

			if (!order) return res.status(404).send("Order not found");
			if (order.paymentStatus === "paid")
				return res.status(200).send("Already processed");

			order.paymentStatus = "paid";
			await order.save();

			const totalPaid = amount / 100;
			const deliveryFee = order.deliveryFee || 0;
			const mealPrice = order.items.reduce((sum, item) => sum + item.price, 0);

			// CHANNEL 1: Credit Vendor Wallet
			await ledgerService.creditAccount(
				order.vendor,
				"VENDOR",
				mealPrice,
				"ORDER_EARNING",
				order._id,
				{ type: "MEAL_PRICE" }
			);

			// CHANNEL 2: Put Rider Fee on HOLD (Escrow)
			if (order.rider && deliveryFee > 0) {
				await ledgerService.holdRiderFee(order.rider, deliveryFee, order._id);
			}

			console.log(
				`✓ Webhook Success: Order ${order._id} distributed to wallets.`
			);
		}

		return res.status(200).send("Webhook processed");
	} catch (err) {
		console.error("Webhook error:", err);
		return res.status(500).send("Server error");
	}
};

module.exports = {
	initialisePayment,
	verifyPayment,
	webhookHandler,
};
