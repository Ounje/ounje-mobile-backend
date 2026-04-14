const axios = require("axios");
const { Payment, Customer, Order, PendingCheckout } = require("../models");
const crypto = require("crypto");
const ledgerService = require("../services/ledger.service");
const orderService = require("../services/order.service");

const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
});

/**
 * 1. Initialize Payment
 *
 * New flow: accepts `cartData` (no orderId). The order is NOT created here.
 * - Calculates the correct total price from cart items + delivery fee + service fee
 * - Stores cartData in PendingCheckout keyed by the Paystack reference
 * - Order is created only after payment is verified (in verifyPayment / webhookHandler)
 *
 * Legacy flow (orderId provided) is still supported for backward compatibility.
 */
const initialisePayment = async (req, res) => {
	try {
		const { orderId, cartData } = req.body;
		const userId = req.user.id;

		const customer = await Customer.findOne({ user: userId }).populate("user");
		if (!customer) return res.status(400).json({ error: "Customer not found" });

		const email = customer.user?.email;
		if (!email) return res.status(400).json({ error: "Customer email is required" });

		let amountInKobo;
		let orderMetadata = { customerId: customer._id.toString() };
		let priceBreakdown = null;

		if (cartData) {
			// ── New flow: cart-based (no order yet) ──────────────────────────────
			const estimate = await orderService.estimateOrderPrice(cartData);
			priceBreakdown = estimate;
			amountInKobo = Math.round(estimate.totalPrice * 100);
			orderMetadata.cartMode = true;
		} else if (orderId) {
			// ── Legacy flow: order already exists ────────────────────────────────
			const order = await Order.findById(orderId);
			if (!order) return res.status(400).json({ error: "Order not found" });
			amountInKobo = Math.round(order.totalPrice * 100);
			orderMetadata.orderId = order._id.toString();
		} else {
			return res.status(400).json({ error: "cartData or orderId is required" });
		}

		const response = await paystack.post("/transaction/initialize", {
			email,
			amount: amountInKobo,
			metadata: orderMetadata,
			callback_url: `${process.env.FRONTEND_URL}/payment/verify`,
		});

		const reference = response.data.data.reference;

		if (cartData) {
			// Store cart data for order creation after payment verification
			await PendingCheckout.create({
				reference,
				customerId: customer._id,
				cartData,
			});
		}

		// Create Payment record as 'pending'
		await Payment.create({
			reference,
			...(orderId ? { orderId } : {}),
			amount: amountInKobo / 100,
			customer: customer._id,
			status: "pending",
		});

		return res.status(200).json({
			...response.data,
			// Return price breakdown so frontend can display the correct total
			totalPrice: priceBreakdown?.totalPrice ?? null,
			deliveryFee: priceBreakdown?.deliveryFee ?? null,
			serviceFee: priceBreakdown?.serviceFee ?? null,
			foodTotal: priceBreakdown?.foodTotal ?? null,
		});
	} catch (err) {
		console.error("Paystack Init Error:", err.response?.data || err.message);
		res.status(500).json({ error: err.message || "Could not initialize payment" });
	}
};

/**
 * 2. Verify Payment
 *
 * Called by the frontend after user returns from the Paystack browser.
 * If a PendingCheckout exists for this reference, creates the order now.
 * Emits newOrderAvailable to vendor only after payment is confirmed.
 */
const verifyPayment = async (req, res) => {
	const { reference } = req.query;
	if (!reference) return res.status(400).json({ error: "Missing reference" });

	try {
		const response = await paystack.get(`/transaction/verify/${reference}`);
		const data = response.data.data;

		const payment = await Payment.findOne({ reference });
		if (!payment) return res.status(404).json({ error: "Payment record not found" });

		payment.status = data.status;

		let createdOrder = null;

		if (data.status === "success") {
			payment.paidAt = data.paid_at;

			// ── New flow: create order from PendingCheckout ───────────────────────
			const pendingCheckout = await PendingCheckout.findOne({ reference });
			if (pendingCheckout) {
				const { cartData, customerId } = pendingCheckout;
				const customerDoc = await Customer.findById(customerId).populate("user");
				if (customerDoc?.user) {
					createdOrder = await orderService.createOrder(customerDoc.user._id, cartData);
					createdOrder.paymentStatus = "paid";
					await createdOrder.save();
					payment.orderId = createdOrder._id;
					// Non-blocking cleanup — don't delay the response
					PendingCheckout.deleteOne({ reference }).catch((err) =>
						console.error(`Failed to delete PendingCheckout: ${err.message}`)
					);

					// Notify vendor — only now, after payment is confirmed
					if (global.io) {
						global.io.to(createdOrder.vendor.toString()).emit("newOrderAvailable", {
							orderId: createdOrder._id,
							message: "New order received!",
						});
					}

					// Fire-and-forget — don't block the response for OTP delivery
					orderService.sendDeliveryOtp(createdOrder).catch((err) =>
						console.error(`Failed to send delivery OTP after Paystack verify: ${err.message}`)
					);
				}
			} else if (payment.orderId) {
				// ── Legacy flow: order already existed ─────────────────────────────
				await Order.findByIdAndUpdate(payment.orderId, { paymentStatus: "paid" });
			}
		}

		await payment.save();

		return res.status(200).json({
			success: true,
			message: `Current payment status is ${data.status}`,
			data: {
				status: data.status,
				reason: data.gateway_response,
				reference: data.reference,
				order: createdOrder ? createdOrder.toObject() : null,
			},
		});
	} catch (err) {
		console.error("Verification Error:", err.response?.data || err.message);
		res.status(500).json({ error: "Payment verification failed" });
	}
};

/**
 * 3. Webhook Handler
 * Paystack calls this server-to-server after a successful charge.
 * Handles PendingCheckout-based order creation (same as verifyPayment).
 */
const webhookHandler = async (req, res) => {
	const secret = process.env.PAYSTACK_TEST_SECRET_KEY;
	const hash = crypto
		.createHmac("sha512", secret)
		.update(JSON.stringify(req.body))
		.digest("hex");

	if (hash !== req.headers["x-paystack-signature"]) {
		return res.status(400).send("Invalid signature");
	}

	try {
		const event = req.body;

		if (event.event === "charge.success") {
			const { amount, metadata, reference, customer: paystackCustomer } = event.data;

			// ── START OF NEW DVA LOGIC ──
            // If the payment came through a virtual bank account (Titan)
            if (event.data.channel === "dedicated_nuban") {
                const naira = amount / 100;
                try {
                    const customer = await Customer.findOne({
                        paystackCustomerCode: paystackCustomer.customer_code,
                    });

                    if (!customer) {
                        console.error(`DVA: No customer for ${paystackCustomer.customer_code}`);
                        return res.status(200).send("Customer not found");
                    }

                    const alreadyProcessed = await Payment.findOne({ reference });
                    if (alreadyProcessed) return res.status(200).send("Already processed");

                    // Record payment & credit wallet
                    await Payment.create({
                        reference,
                        customer: customer._id,
                        amount: naira,
                        status: "success",
                        paidAt: event.data.paid_at,
                    });

                    await ledgerService.creditAccount(
                        customer._id,
                        "CUSTOMER",
                        naira,
                        "DVA_TRANSFER",
                        { reference }
                    );

                    if (global.io) {
                        global.io.to(customer._id.toString()).emit("walletCredited", {
                            amount: naira,
                            reference,
                            message: `₦${naira.toLocaleString()} added to your wallet`,
                        });
                    }
                } catch (err) {
                    console.error("DVA error:", err.message);
                }
                return res.status(200).send("DVA processed");
            }
            // ── END OF NEW DVA LOGIC ──

			// ── New flow: PendingCheckout exists ─────────────────────────────────
			const pendingCheckout = await PendingCheckout.findOne({ reference });
			if (pendingCheckout) {
				const { cartData, customerId } = pendingCheckout;
				const customerDoc = await Customer.findById(customerId).populate("user");

				if (customerDoc?.user) {
					// Guard against duplicate webhook delivery
					const existingPayment = await Payment.findOne({ reference });
					if (existingPayment?.orderId) {
						return res.status(200).send("Already processed");
					}

					const order = await orderService.createOrder(customerDoc.user._id, cartData);
					order.paymentStatus = "paid";
					await order.save();

					await Payment.findOneAndUpdate({ reference }, { orderId: order._id, status: "success" });
					await PendingCheckout.deleteOne({ reference });

					// Send delivery OTP
					try {
						await orderService.sendDeliveryOtp(order);
					} catch (err) {
						console.error(`Failed to send delivery OTP in webhook: ${err.message}`);
					}

					// Hold vendor net earnings
					const vendorAmount = order.vendorEarning > 0
						? order.vendorEarning
						: order.items.reduce((sum, item) => sum + item.price, 0);
					if (vendorAmount > 0) {
						await ledgerService.holdVendorAmount(order.vendor, vendorAmount, order._id);
					}

					// Notify vendor — after payment confirmed
					if (global.io) {
						global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
							orderId: order._id,
							message: "New order received!",
						});
					}

					console.log(`✓ Webhook (cart mode): Order ${order._id} created and distributed.`);
				}

				return res.status(200).send("Webhook processed");
			}

			// ── Legacy flow: order already existed ───────────────────────────────
			const order = await Order.findById(metadata?.orderId).populate("items");
			if (!order) return res.status(404).send("Order not found");
			if (order.paymentStatus === "paid") return res.status(200).send("Already processed");

			order.paymentStatus = "paid";
			await order.save();

			try {
				await orderService.sendDeliveryOtp(order);
			} catch (err) {
				console.error(`Failed to send delivery OTP after payment: ${err.message}`);
			}

			const totalPaid = amount / 100;
			const deliveryFee = order.deliveryFee || 0;
			const vendorAmount = order.vendorEarning > 0
				? order.vendorEarning
				: order.items.reduce((sum, item) => sum + item.price, 0);

			if (vendorAmount > 0) {
				await ledgerService.holdVendorAmount(order.vendor, vendorAmount, order._id);
			}

			if (order.rider && deliveryFee > 0) {
				await ledgerService.holdRiderFee(order.rider, deliveryFee, order._id);
			}

			// Notify vendor
			if (global.io) {
				global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
					orderId: order._id,
					message: "New order received!",
				});
			}

			console.log(`✓ Webhook (legacy): Order ${order._id} distributed to wallets.`);
		}

		return res.status(200).send("Webhook processed");
	} catch (err) {
		console.error("Webhook error:", err);
		return res.status(500).send("Server error");
	}
};

/**
 * 4. Wallet Payment
 *
 * New flow: accepts `cartData` (no orderId). Creates order + charges wallet atomically.
 * Legacy flow: accepts `orderId` — still supported.
 */
const walletPayment = async (req, res) => {
	try {
		const { orderId, cartData } = req.body;
		const userId = req.user.id;

		if (!orderId && !cartData) {
			return res.status(400).json({ success: false, message: "orderId or cartData is required" });
		}

		const customer = await Customer.findOne({ user: userId });
		if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

		let order;

		if (cartData) {
			// ── New flow: create order now (after wallet balance confirmed) ───────

			// First estimate price to check wallet balance before creating order
			const estimate = await orderService.estimateOrderPrice(cartData);
			const totalPrice = estimate.totalPrice;

			const { availableBalance } = await ledgerService.getAccountBalance(customer._id, "CUSTOMER");
			if (availableBalance < totalPrice) {
				return res.status(400).json({
					success: false,
					message: "Insufficient wallet balance",
				});
			}

			// Create order — payment is guaranteed (balance checked above)
			order = await orderService.createOrder(userId, cartData);

			// Debit customer wallet
			await ledgerService.debitAccount(
				customer._id,
				"CUSTOMER",
				order.totalPrice,
				"WALLET_PAYMENT",
				{ orderId: order._id },
			);

			order.paymentStatus = "paid";
			order.paymentMethod = "wallet";
			await order.save();

		} else {
			// ── Legacy flow: order already exists ─────────────────────────────────
			order = await Order.findById(orderId).populate("items");
			if (!order) return res.status(404).json({ success: false, message: "Order not found" });
			if (order.paymentStatus === "paid") {
				return res.status(400).json({ success: false, message: "Order is already paid" });
			}

			const { availableBalance } = await ledgerService.getAccountBalance(customer._id, "CUSTOMER");
			if (availableBalance < order.totalPrice) {
				return res.status(400).json({ success: false, message: "Insufficient wallet balance" });
			}

			await ledgerService.debitAccount(
				customer._id,
				"CUSTOMER",
				order.totalPrice,
				"WALLET_PAYMENT",
				{ orderId: order._id },
			);

			order.paymentStatus = "paid";
			order.paymentMethod = "wallet";
			await order.save();
		}

		// Send delivery OTP
		try {
			await orderService.sendDeliveryOtp(order);
		} catch (err) {
			console.error(`Failed to send delivery OTP after wallet payment: ${err.message}`);
		}

		// Hold vendor net earnings
		const vendorAmount = order.vendorEarning > 0
			? order.vendorEarning
			: (order.items || []).reduce((sum, item) => sum + item.price, 0);
		if (vendorAmount > 0) {
			await ledgerService.holdVendorAmount(order.vendor, vendorAmount, order._id);
		}

		// Hold rider fee if rider already assigned
		const deliveryFee = order.deliveryFee || 0;
		if (order.rider && deliveryFee > 0) {
			await ledgerService.holdRiderFee(order.rider, deliveryFee, order._id);
		}

		// Notify vendor — only NOW, after payment confirmed
		if (global.io) {
			global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
				orderId: order._id,
				message: "New order received!",
			});
		}

		return res.status(200).json({ success: true, order });
	} catch (error) {
		console.error("Wallet Payment Error:", error.message);
		return res.status(500).json({ success: false, message: error.message || "Wallet payment failed" });
	}
};

module.exports = {
	initialisePayment,
	verifyPayment,
	webhookHandler,
	walletPayment,
};
