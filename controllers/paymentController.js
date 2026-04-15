const axios = require("axios");
const { Payment, Customer, Order, PendingCheckout } = require("../models");
const crypto = require("crypto");
const ledgerService = require("../services/ledger.service");
const orderService = require("../services/order.service");
const payoutService = require("../services/payout.service");
const logger = require("../utils/logger"); //  FIX #8: use logger

const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
});

/**
 * 1. Initialize Payment
 */
const initialisePayment = async (req, res) => {
	try {
		const { orderId, cartData } = req.body;
		const userId = req.user.id;

		const customer = await Customer.findOne({ user: userId }).populate("user");
		if (!customer) return res.status(400).json({ error: "Customer not found" });

		const email = customer.user?.email;
		if (!email)
			return res.status(400).json({ error: "Customer email is required" });

		let amountInKobo;
		let orderMetadata = { customerId: customer._id.toString() };
		let priceBreakdown = null;

		if (cartData) {
			const estimate = await orderService.estimateOrderPrice(cartData);
			priceBreakdown = estimate;
			amountInKobo = Math.round(estimate.totalPrice * 100);
			orderMetadata.cartMode = true;
		} else if (orderId) {
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
			await PendingCheckout.create({
				reference,
				customerId: customer._id,
				cartData,
			});
		}

		await Payment.create({
			reference,
			...(orderId ? { orderId } : {}),
			amount: amountInKobo / 100,
			customer: customer._id,
			status: "pending",
		});

		return res.status(200).json({
			...response.data,
			totalPrice: priceBreakdown?.totalPrice ?? null,
			deliveryFee: priceBreakdown?.deliveryFee ?? null,
			serviceFee: priceBreakdown?.serviceFee ?? null,
			foodTotal: priceBreakdown?.foodTotal ?? null,
		});
	} catch (err) {
		logger.error("Paystack Init Error:", err.response?.data || err.message);
		res
			.status(500)
			.json({ error: err.message || "Could not initialize payment" });
	}
};

/**
 * 2. Verify Payment
 * Called by frontend after Paystack redirect.
 *  FIX #1: Guards against double order creation if webhook already fired.
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

		payment.status = data.status;

		let createdOrder = null;

		if (data.status === "success") {
			payment.paidAt = data.paid_at;

			const pendingCheckout = await PendingCheckout.findOne({ reference });
			if (pendingCheckout) {
				//  FIX #1: check if webhook already created the order
				if (payment.orderId) {
					// Webhook beat us to it — just fetch the existing order
					createdOrder = await Order.findById(payment.orderId);
				} else {
					const { cartData, customerId } = pendingCheckout;
					const customerDoc =
						await Customer.findById(customerId).populate("user");

					if (customerDoc?.user) {
						createdOrder = await orderService.createOrder(
							customerDoc.user._id,
							cartData,
						);
						createdOrder.paymentStatus = "paid";
						await createdOrder.save();
						payment.orderId = createdOrder._id;

						PendingCheckout.deleteOne({ reference }).catch((err) =>
							logger.error(`Failed to delete PendingCheckout: ${err.message}`),
						);

						if (global.io) {
							global.io
								.to(createdOrder.vendor.toString())
								.emit("newOrderAvailable", {
									orderId: createdOrder._id,
									message: "New order received!",
								});
						}

						//  FIX #7: consistent fire-and-forget for OTP
						orderService
							.sendDeliveryOtp(createdOrder)
							.catch((err) =>
								logger.error(
									`Failed to send delivery OTP after Paystack verify: ${err.message}`,
								),
							);
					}
				}
			} else if (payment.orderId) {
				// Legacy flow
				await Order.findByIdAndUpdate(payment.orderId, {
					paymentStatus: "paid",
				});
				createdOrder = await Order.findById(payment.orderId);
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
		logger.error("Verification Error:", err.response?.data || err.message);
		res.status(500).json({ error: "Payment verification failed" });
	}
};

/**
 * 3. Webhook Handler
 *  FIX #3: uses PAYSTACK_SECRET_KEY (not test key)
 *  FIX #4: holdRiderFee added to cart flow
 *  FIX #6: DVA creditAccount orderId param fixed
 *  FIX #9: always returns 200 — Paystack retries on non-2xx
 */
const webhookHandler = async (req, res) => {
	//  FIX #3: consistent key — not test-specific
	const secret = process.env.PAYSTACK_SECRET_KEY;
	const hash = crypto
		.createHmac("sha512", secret)
		.update(JSON.stringify(req.body))
		.digest("hex");

	if (hash !== req.headers["x-paystack-signature"]) {
		return res.status(400).send("Invalid signature");
	}

	//  FIX #9: wrap everything — always return 200 to Paystack
	try {
		const event = req.body;

		// ── transfer.success → finalize ledger payout ─────────────────────────
		if (event.event === "transfer.success") {
			const transferCode = event.data?.transfer_code;
			if (transferCode) {
				await payoutService.handleTransferSuccess(transferCode);
			}
			return res.status(200).send("Webhook processed");
		}

		// ── transfer.failed / transfer.reversed → reverse ledger reserve ──────
		if (
			event.event === "transfer.failed" ||
			event.event === "transfer.reversed"
		) {
			const transferCode = event.data?.transfer_code;
			const reason = event.data?.reason || event.event;
			if (transferCode) {
				await payoutService.handleTransferFailure(transferCode, reason);
			}
			return res.status(200).send("Webhook processed");
		}

		// ── DVA account assigned by Paystack ─────────────────────────────────────
		if (event.event === "dedicatedaccount.assign.success") {
		const { customer, bank, account_number, account_name } = event.data;

		await Customer.findOneAndUpdate(
			{ "virtualAccount.paystackCustomerCode": customer.customer_code },
			{
			$set: {
				"virtualAccount.accountNumber": account_number,
				"virtualAccount.accountName":   account_name,
				"virtualAccount.bankName":       bank.name,
				"virtualAccount.bankId":         bank.id,
				"virtualAccount.active":         true,
				"virtualAccount.assignedAt":     new Date(),
			},
			}
		);

		logger.info(`✓ DVA assigned: ${account_number} (${customer.customer_code})`);
		return res.status(200).send("Webhook processed");
		}

		// ── DVA assignment failed — log it so you can retry ──────────────────────
		if (event.event === "dedicatedaccount.assign.failed") {
		const { customer } = event.data;
		logger.error(
			`DVA assignment failed for customer: ${customer?.customer_code}`
		);
		// Don't retry here automatically — use the admin retry route
		return res.status(200).send("Webhook processed");
		}

		if (event.event === "charge.success") {
			const {
				amount,
				metadata,
				reference,
				customer: paystackCustomer,
			} = event.data;

			// ── DVA: virtual bank account top-up ─────────────────────────────────
			if (event.data.channel === "dedicated_nuban") {
				const naira = amount / 100;
				try {
					const customer = await Customer.findOne({
						paystackCustomerCode: paystackCustomer.customer_code,
					});

					if (!customer) {
						logger.error(
							`DVA: No customer for ${paystackCustomer.customer_code}`,
						);
						return res.status(200).send("Customer not found");
					}

					const alreadyProcessed = await Payment.findOne({ reference });
					if (alreadyProcessed)
						return res.status(200).send("Already processed");

					await Payment.create({
						reference,
						customer: customer._id,
						amount: naira,
						status: "success",
						paidAt: event.data.paid_at,
					});

					//  FIX #6: pass null as orderId, reference goes in metadata
					await ledgerService.creditAccount(
						customer._id,
						"CUSTOMER",
						naira,
						"DVA_TRANSFER",
						null,
						{ reference },
					);

					if (global.io) {
						global.io.to(customer._id.toString()).emit("walletCredited", {
							amount: naira,
							reference,
							message: `₦${naira.toLocaleString()} added to your wallet`,
						});
					}
				} catch (err) {
					logger.error("DVA error:", err.message);
				}
				return res.status(200).send("DVA processed");
			}

			// ── New flow: PendingCheckout ─────────────────────────────────────────
			const pendingCheckout = await PendingCheckout.findOne({ reference });
			if (pendingCheckout) {
				const { cartData, customerId } = pendingCheckout;
				const customerDoc =
					await Customer.findById(customerId).populate("user");

				if (customerDoc?.user) {
					const existingPayment = await Payment.findOne({ reference });
					if (existingPayment?.orderId) {
						return res.status(200).send("Already processed");
					}

					const order = await orderService.createOrder(
						customerDoc.user._id,
						cartData,
					);
					order.paymentStatus = "paid";
					await order.save();

					await Payment.findOneAndUpdate(
						{ reference },
						{ orderId: order._id, status: "success" },
					);
					await PendingCheckout.deleteOne({ reference });

					//  FIX #7: consistent fire-and-forget for OTP
					orderService
						.sendDeliveryOtp(order)
						.catch((err) =>
							logger.error(
								`Failed to send delivery OTP in webhook: ${err.message}`,
							),
						);

					const vendorAmount =
						order.vendorEarning > 0
							? order.vendorEarning
							: order.items.reduce((sum, item) => sum + item.price, 0);
					if (vendorAmount > 0) {
						await ledgerService.holdVendorAmount(
							order.vendor,
							vendorAmount,
							order._id,
						);
					}

					//  FIX #4: holdRiderFee was missing in cart flow
					const deliveryFee = order.deliveryFee || 0;
					if (order.rider && deliveryFee > 0) {
						await ledgerService.holdRiderFee(
							order.rider,
							deliveryFee,
							order._id,
						);
					}

					if (global.io) {
						global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
							orderId: order._id,
							message: "New order received!",
						});
					}

					logger.info(
						`✓ Webhook (cart mode): Order ${order._id} created and distributed.`,
					);
				}

				return res.status(200).send("Webhook processed");
			}

			// ── Legacy flow ───────────────────────────────────────────────────────
			const order = await Order.findById(metadata?.orderId).populate("items");
			if (!order) return res.status(200).send("Order not found"); //  FIX #9: 200 not 404
			if (order.paymentStatus === "paid")
				return res.status(200).send("Already processed");

			order.paymentStatus = "paid";
			await order.save();

			//  FIX #7: consistent fire-and-forget
			orderService
				.sendDeliveryOtp(order)
				.catch((err) =>
					logger.error(
						`Failed to send delivery OTP after payment: ${err.message}`,
					),
				);

			const deliveryFee = order.deliveryFee || 0;
			const vendorAmount =
				order.vendorEarning > 0
					? order.vendorEarning
					: order.items.reduce((sum, item) => sum + item.price, 0);

			if (vendorAmount > 0) {
				await ledgerService.holdVendorAmount(
					order.vendor,
					vendorAmount,
					order._id,
				);
			}
			if (order.rider && deliveryFee > 0) {
				await ledgerService.holdRiderFee(order.rider, deliveryFee, order._id);
			}

			if (global.io) {
				global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
					orderId: order._id,
					message: "New order received!",
				});
			}

			logger.info(
				`✓ Webhook (legacy): Order ${order._id} distributed to wallets.`,
			);
		}

		return res.status(200).send("Webhook processed");
	} catch (err) {
		//  FIX #9: log error but always return 200 — prevents Paystack retry storm
		logger.error("Webhook error:", err);
		return res.status(200).send("Error logged");
	}
};

/**
 * 4. Wallet Payment
 *  FIX #2: debit before createOrder to prevent TOCTOU
 *  FIX #5: debit uses estimate.totalPrice (same amount balance was checked against)
 */
const walletPayment = async (req, res) => {
	try {
		const { orderId, cartData } = req.body;
		const userId = req.user.id;

		if (!orderId && !cartData) {
			return res
				.status(400)
				.json({ success: false, message: "orderId or cartData is required" });
		}

		const customer = await Customer.findOne({ user: userId });
		if (!customer)
			return res
				.status(404)
				.json({ success: false, message: "Customer not found" });

		let order;

		if (cartData) {
			const estimate = await orderService.estimateOrderPrice(cartData);
			const totalPrice = estimate.totalPrice;

			//  FIX #2 + #5: debit FIRST using estimate amount, then create order
			// If debit fails → insufficient funds, no order created (clean)
			// If createOrder fails after debit → reverse the debit (clean)
			await ledgerService.debitAccount(
				customer._id,
				"CUSTOMER",
				totalPrice,
				"WALLET_PAYMENT",
				null,
				{ note: "pre-order debit" },
			);

			try {
				order = await orderService.createOrder(userId, cartData);
			} catch (createErr) {
				// Rollback the debit if order creation fails
				await ledgerService.creditAccount(
					customer._id,
					"CUSTOMER",
					totalPrice,
					"REFUND",
					null,
					{ note: "wallet_payment_order_creation_failed" },
				);
				throw createErr;
			}

			order.paymentStatus = "paid";
			order.paymentMethod = "wallet";
			await order.save();
		} else {
			// Legacy flow
			order = await Order.findById(orderId).populate("items");
			if (!order)
				return res
					.status(404)
					.json({ success: false, message: "Order not found" });
			if (order.paymentStatus === "paid") {
				return res
					.status(400)
					.json({ success: false, message: "Order is already paid" });
			}

			//  FIX #2: atomic debit — will throw if insufficient (no separate check needed)
			await ledgerService.debitAccount(
				customer._id,
				"CUSTOMER",
				order.totalPrice,
				"WALLET_PAYMENT",
				order._id,
			);

			order.paymentStatus = "paid";
			order.paymentMethod = "wallet";
			await order.save();
		}

		//  FIX #7: consistent fire-and-forget for OTP
		orderService
			.sendDeliveryOtp(order)
			.catch((err) =>
				logger.error(
					`Failed to send delivery OTP after wallet payment: ${err.message}`,
				),
			);

		const vendorAmount =
			order.vendorEarning > 0
				? order.vendorEarning
				: (order.items || []).reduce((sum, item) => sum + item.price, 0);
		if (vendorAmount > 0) {
			await ledgerService.holdVendorAmount(
				order.vendor,
				vendorAmount,
				order._id,
			);
		}

		const deliveryFee = order.deliveryFee || 0;
		if (order.rider && deliveryFee > 0) {
			await ledgerService.holdRiderFee(order.rider, deliveryFee, order._id);
		}

		if (global.io) {
			global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
				orderId: order._id,
				message: "New order received!",
			});
		}

		return res.status(200).json({ success: true, order });
	} catch (error) {
		logger.error("Wallet Payment Error:", error.message);
		// Surface insufficient funds clearly to the client
		if (error.message?.includes("Insufficient")) {
			return res
				.status(400)
				.json({ success: false, message: "Insufficient wallet balance" });
		}
		return res.status(500).json({
			success: false,
			message: error.message || "Wallet payment failed",
		});
	}
};

module.exports = {
	initialisePayment,
	verifyPayment,
	webhookHandler,
	walletPayment,
};
