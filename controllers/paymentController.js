const mongoose = require("mongoose");
const axios = require("axios");
const { Payment, Customer, Order, PendingCheckout } = require("../models");
const crypto = require("crypto");
const ledgerService = require("../services/ledger.service");
const orderService = require("../services/order.service");
const payoutService = require("../services/payout.service");
const emailService = require("../services/email/EmailService");
const logger = require("../utils/logger");

const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Convert naira to kobo for ledger operations.
 * All Order model prices are in naira — must be converted before hitting the ledger.
 */
const toKobo = (naira) => Math.round((naira ?? 0) * 100);

/**
 * Hold vendor earnings in ledger (kobo).
 * order.vendorEarning and order.items[].price are in naira — convert before passing.
 */
const _holdVendorEarnings = async (order) => {
	const vendorAmountNaira =
		order.vendorEarning > 0
			? order.vendorEarning
			: (order.items ?? []).reduce((sum, item) => sum + (item.price ?? 0), 0);

	if (vendorAmountNaira > 0) {
		await ledgerService.holdVendorAmount(
			order.vendor,
			toKobo(vendorAmountNaira), // naira → kobo
			order._id,
		);
		logger.info(
			`[Payment] holdVendorEarnings | orderId=${order._id} vendorId=${order.vendor} amountKobo=${toKobo(vendorAmountNaira)} (₦${vendorAmountNaira})`,
		);
	}
};

/**
 * Hold rider delivery fee in ledger (kobo).
 * order.deliveryFee is in naira — convert before passing.
 */
const _holdRiderFee = async (order) => {
	const deliveryFeeNaira = order.deliveryFee ?? 0;

	if (order.rider && deliveryFeeNaira > 0) {
		await ledgerService.holdRiderFee(
			order.rider,
			toKobo(deliveryFeeNaira), // naira → kobo
			order._id,
		);
		logger.info(
			`[Payment] holdRiderFee | orderId=${order._id} riderId=${order.rider} amountKobo=${toKobo(deliveryFeeNaira)} (₦${deliveryFeeNaira})`,
		);
	}
};

// ─── CONTROLLERS ──────────────────────────────────────────────────────────────

/**
 * 1. Initialize Payment
 * POST /api/payments/initialize
 *
 * Paystack expects amount in kobo.
 * Order prices are in naira → multiply × 100.
 */
const initialisePayment = async (req, res) => {
	try {
		const { orderId, cartData } = req.body;
		const userId = req.user.id;

		logger.info(
			`[Payment] initialise | userId=${userId} orderId=${orderId ?? "cart"}`,
		);

		const customer = await Customer.findOne({ user: userId }).populate("user");
		if (!customer) return res.status(400).json({ error: "Customer not found" });

		const email = customer.user?.email;
		if (!email)
			return res.status(400).json({ error: "Customer email is required" });

		let amountInKobo;
		let orderMetadata = { customerId: customer._id.toString() };
		let priceBreakdown = null;

		if (cartData) {
			// estimateOrderPrice returns naira → convert to kobo for Paystack
			const estimate = await orderService.estimateOrderPrice(cartData);
			priceBreakdown = estimate;
			amountInKobo = toKobo(estimate.totalPrice); // naira → kobo
			orderMetadata.cartMode = true;
		} else if (orderId) {
			const order = await Order.findById(orderId);
			if (!order) return res.status(400).json({ error: "Order not found" });
			amountInKobo = toKobo(order.totalPrice); // naira → kobo
			orderMetadata.orderId = order._id.toString();
		} else {
			return res.status(400).json({ error: "cartData or orderId is required" });
		}

		logger.info(
			`[Payment] initialise | amountKobo=${amountInKobo} (₦${amountInKobo / 100})`,
		);

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
			amount: amountInKobo / 100, // Payment model stores naira (legacy — do not change)
			customer: customer._id,
			status: "pending",
		});

		logger.info(
			`[Payment] initialised | ref=${reference} customerId=${customer._id} amountKobo=${amountInKobo}`,
		);

		return res.status(200).json({
			...response.data,
			// Return naira to frontend for display
			totalPrice: priceBreakdown?.totalPrice ?? null,
			deliveryFee: priceBreakdown?.deliveryFee ?? null,
			serviceFee: priceBreakdown?.serviceFee ?? null,
			foodTotal: priceBreakdown?.foodTotal ?? null,
		});
	} catch (err) {
		logger.error(
			"[Payment] initialise error:",
			err.response?.data || err.message,
		);
		res
			.status(500)
			.json({ error: err.message || "Could not initialize payment" });
	}
};

/**
 * 2. Verify Payment
 * GET /api/payments/verify?reference=
 */
const verifyPayment = async (req, res) => {
	const { reference } = req.query;
	if (!reference) return res.status(400).json({ error: "Missing reference" });

	logger.info(`[Payment] verify | ref=${reference}`);

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
				if (payment.orderId) {
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

						orderService
							.sendDeliveryOtp(createdOrder)
							.catch((err) =>
								logger.error(
									`Failed to send delivery OTP after verify: ${err.message}`,
								),
							);
					}
				}
			} else if (payment.orderId) {
				await Order.findByIdAndUpdate(payment.orderId, {
					paymentStatus: "paid",
				});
				createdOrder = await Order.findById(payment.orderId);
			}
		}

		await payment.save();

		logger.info(
			`[Payment] verified | ref=${reference} status=${data.status} orderId=${createdOrder?._id ?? payment.orderId ?? "none"}`,
		);

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
		const paystackError =
			err.response?.data?.message || err.response?.data?.error || err.message;
		logger.error("[Payment] verify error:", err.response?.data || err.message);
		res
			.status(500)
			.json({ error: paystackError || "Payment verification failed" });
	}
};

/**
 * 3. Webhook Handler
 * POST /api/webhooks/paystack
 *
 * ⚠️  Paystack webhook `amount` is ALWAYS in kobo.
 *     Order model prices are in naira — use toKobo() before passing to ledger.
 */
const webhookHandler = async (req, res) => {
	const secret = process.env.PAYSTACK_SECRET_KEY;

	const hash = crypto
		.createHmac("sha512", secret)
		.update(req.body)
		.digest("hex");

	const sigOk = hash === req.headers["x-paystack-signature"];

	let event;
	try {
		event = JSON.parse(req.body.toString());
	} catch {
		logger.warn("[Webhook] invalid JSON body");
		return res.status(400).send("Invalid JSON");
	}

	logger.info(`[Webhook] received event="${event.event}" sig_ok=${sigOk}`);

	if (!sigOk) {
		logger.warn(
			`[Webhook] signature mismatch | body_is_buffer=${Buffer.isBuffer(req.body)} | body_length=${req.body?.length}`,
		);
		return res.status(400).send("Invalid signature");
	}

	logger.info(
		`[Webhook] processing | channel=${event.data?.channel} ref=${event.data?.reference}`,
	);

	try {
		// ── transfer.success ──────────────────────────────────────────────────
		if (event.event === "transfer.success") {
			const transferCode = event.data?.transfer_code;
			if (transferCode) await payoutService.handleTransferSuccess(transferCode);
			return res.status(200).send("Webhook processed");
		}

		// ── transfer.failed / transfer.reversed ───────────────────────────────
		if (
			event.event === "transfer.failed" ||
			event.event === "transfer.reversed"
		) {
			const transferCode = event.data?.transfer_code;
			const reason = event.data?.reason || event.event;
			if (transferCode)
				await payoutService.handleTransferFailure(transferCode, reason);
			return res.status(200).send("Webhook processed");
		}

		// ── dedicatedaccount.assign.success ───────────────────────────────────
		if (event.event === "dedicatedaccount.assign.success") {
			const { customer, bank, account_number, account_name } = event.data;
			await Customer.findOneAndUpdate(
				{ paystackCustomerCode: customer.customer_code },
				{
					$set: {
						"titanAccount.accountNumber": account_number,
						"titanAccount.accountName": account_name,
						"titanAccount.bankName": bank.name,
						"titanAccount.bankSlug": bank.slug,
					},
				},
			);
			logger.info(
				`[Webhook] DVA assigned: ${account_number} (${customer.customer_code})`,
			);
			return res.status(200).send("Webhook processed");
		}

		// ── dedicatedaccount.assign.failed ────────────────────────────────────
		if (event.event === "dedicatedaccount.assign.failed") {
			logger.error(
				`[Webhook] DVA assignment failed for: ${event.data?.customer?.customer_code}`,
			);
			return res.status(200).send("Webhook processed");
		}

		// ── charge.success ────────────────────────────────────────────────────
		if (event.event === "charge.success") {
			const {
				amount,
				metadata,
				reference,
				customer: paystackCustomer,
			} = event.data;

			// amount from Paystack is ALWAYS in kobo — use directly for ledger
			const amountKobo = amount;

			logger.info(
				`[Webhook] charge.success | ref=${reference} amountKobo=${amountKobo} (₦${amountKobo / 100}) channel=${event.data.channel}`,
			);

			// ── DVA top-up via virtual account ────────────────────────────────
			if (event.data.channel === "dedicated_nuban") {
				try {
					const customer = await Customer.findOne({
						paystackCustomerCode: paystackCustomer.customer_code,
					});

					logger.info(
						`[Webhook] DVA top-up | code=${paystackCustomer.customer_code} found=${!!customer} amountKobo=${amountKobo} (₦${amountKobo / 100})`,
					);

					if (!customer) {
						logger.error(
							`[Webhook] DVA: no customer for ${paystackCustomer.customer_code}`,
						);
						return res.status(200).send("Customer not found");
					}

					const alreadyProcessed = await Payment.findOne({ reference });
					if (alreadyProcessed) {
						logger.info(`[Webhook] DVA: already processed ref=${reference}`);
						return res.status(200).send("Already processed");
					}

					await Payment.create({
						reference,
						customer: customer._id,
						amount: amountKobo / 100, // Payment model stores naira (legacy)
						status: "success",
						paidAt: event.data.paid_at,
					});

					// Paystack amount is already kobo — pass directly to ledger
					const result = await ledgerService.creditAccount(
						customer._id,
						"CUSTOMER",
						amountKobo, // ✅ kobo
						"DVA_TRANSFER",
						null,
						{ paystackReference: reference, channel: event.data.channel },
					);

					logger.info(
						`[Webhook] DVA credited ${amountKobo} kobo (₦${amountKobo / 100}) to customer ${customer._id} | newBalance=${result?.newBalance}`,
					);

					// Email — fire and forget
					Customer.findById(customer._id)
						.populate("user")
						.then((populated) => {
							if (populated?.user?.email) {
								emailService
									.transferSuccessEmail(
										populated.user.email,
										populated.firstName || populated.user.name,
										`₦${(amountKobo / 100).toLocaleString()}`,
										populated.titanAccount?.accountNumber,
									)
									.catch((err) =>
										logger.error(
											`[Webhook] Transfer email failed: ${err.message}`,
										),
									);
							}
						})
						.catch((err) =>
							logger.error(`[Webhook] Email populate failed: ${err.message}`),
						);

					if (global.io) {
						global.io.to(customer._id.toString()).emit("walletCredited", {
							amount: amountKobo / 100, // naira for frontend display
							reference,
							message: `₦${(amountKobo / 100).toLocaleString()} added to your wallet`,
						});
					}

					try {
						const notificationService = require("../services/notification.service");
						await notificationService.notifyCustomerWalletTopup(
							customer._id,
							amountKobo / 100, // naira for notification display
						);
					} catch (pushErr) {
						logger.error(
							`[Webhook] Push notification failed: ${pushErr.message}`,
						);
					}
				} catch (err) {
					logger.error(`[Webhook] DVA error: ${err.message}`);
				}
				return res.status(200).send("DVA processed");
			}

			// ── PendingCheckout flow ───────────────────────────────────────────
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

					orderService
						.sendDeliveryOtp(order)
						.catch((err) =>
							logger.error(
								`Failed to send delivery OTP in webhook: ${err.message}`,
							),
						);

					// Order prices are in naira → toKobo() before ledger
					await _holdVendorEarnings(order);
					await _holdRiderFee(order);

					if (global.io) {
						global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
							orderId: order._id,
							message: "New order received!",
						});
					}

					logger.info(
						`[Webhook] cart mode: Order ${order._id} created and funds held`,
					);
				}
				return res.status(200).send("Webhook processed");
			}

			// ── Legacy flow (orderId in metadata) ─────────────────────────────
			const order = await Order.findById(metadata?.orderId).populate("items");
			if (!order) return res.status(200).send("Order not found");
			if (order.paymentStatus === "paid")
				return res.status(200).send("Already processed");

			order.paymentStatus = "paid";
			await order.save();

			orderService
				.sendDeliveryOtp(order)
				.catch((err) =>
					logger.error(
						`Failed to send delivery OTP after payment: ${err.message}`,
					),
				);

			// Order prices are in naira → toKobo() before ledger
			await _holdVendorEarnings(order);
			await _holdRiderFee(order);

			if (global.io) {
				global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
					orderId: order._id,
					message: "New order received!",
				});
			}

			logger.info(`[Webhook] legacy: Order ${order._id} distributed`);
		}

		return res.status(200).send("Webhook processed");
	} catch (err) {
		logger.error(`[Webhook] error: ${err.message}`, err);
		return res.status(200).send("Error logged");
	}
};

/**
 * 4. Wallet Payment
 * POST /api/payments/wallet
 *
 * order.totalPrice is in naira → toKobo() before ledger debit.
 */
const walletPayment = async (req, res) => {
	try {
		const { orderId, cartData } = req.body;
		const userId = req.user.id;

		logger.info(
			`[Payment] wallet | userId=${userId} orderId=${orderId ?? "cart"}`,
		);

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
			// estimateOrderPrice returns naira
			const estimate = await orderService.estimateOrderPrice(cartData);
			const totalNaira = estimate.totalPrice;
			const totalKobo = toKobo(totalNaira);

			// Debug: log the estimate breakdown and live wallet balance before debit
			const liveBalance = await ledgerService.getAccountBalance(
				customer._id,
				"CUSTOMER",
			);
			logger.info(
				`[Payment] wallet debug | customerId=${customer._id} estimateFoodTotal=${estimate.foodTotal} estimateDelivery=${estimate.deliveryFee} estimateService=${estimate.serviceFee} estimateTotal=${totalNaira} cartPromoDiscount=${cartData.promoDiscount ?? 0} liveBalance=${liveBalance.availableBalance}`,
			);

			await ledgerService.debitAccount(
				customer._id,
				"CUSTOMER",
				totalKobo, // ✅ kobo
				"WALLET_PAYMENT",
				null,
				{ note: "pre-order debit" },
			);

			try {
				order = await orderService.createOrder(userId, cartData);
			} catch (createErr) {
				// Refund if order creation fails — credit kobo back
				await ledgerService.creditAccount(
					customer._id,
					"CUSTOMER",
					totalKobo, // ✅ kobo
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

			const totalKobo = toKobo(order.totalPrice); // naira → kobo

			logger.info(
				`[Payment] wallet orderId | orderId=${orderId} totalNaira=₦${order.totalPrice} totalKobo=${totalKobo}`,
			);

			// Debit customer ledger in kobo
			await ledgerService.debitAccount(
				customer._id,
				"CUSTOMER",
				totalKobo, // ✅ kobo
				"WALLET_PAYMENT",
				order._id,
			);

			order.paymentStatus = "paid";
			order.paymentMethod = "wallet";
			await order.save();
		}

		orderService
			.sendDeliveryOtp(order)
			.catch((err) =>
				logger.error(
					`Failed to send delivery OTP after wallet payment: ${err.message}`,
				),
			);

		// Order prices are in naira → toKobo() before ledger
		await _holdVendorEarnings(order);
		await _holdRiderFee(order);

		if (global.io) {
			global.io.to(order.vendor.toString()).emit("newOrderAvailable", {
				orderId: order._id,
				message: "New order received!",
			});
		}

		logger.info(
			`[Payment] wallet success | orderId=${order._id} customerId=${customer._id} totalNaira=₦${order.totalPrice}`,
		);

		return res.status(200).json({ success: true, order });
	} catch (error) {
		logger.error(
			`[Payment] wallet error: ${error?.message || error?.toString() || JSON.stringify(error)}`,
		);
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
