const { LedgerEntry, LedgerAccount } = require("../models");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

/**
 * Ledger Service — Double-entry bookkeeping
 *
 *   ALL AMOUNTS ARE IN KOBO (1 naira = 100 kobo).
 * Every caller must pass kobo values. Controllers divide by 100 before
 * returning naira to the frontend.
 *
 * Flow:
 * 1. Order paid         → holdVendorAmount + holdRiderFee (hold)
 * 2. Vendor accepts     → pendVendorEarning (hold → pending)
 * 3. Delivery OTP       → releaseVendorAmount + releaseRiderFee (→ available)
 * 4. Payout requested   → reserveBalance (available → pending)
 * 5. Transfer success   → completePayout (pending → out)
 * 6. Transfer failed    → reverseReserve (pending → available)
 */

const ensureAccount = async (userId, type, session = null) => {
	const options = { upsert: true, new: true, setDefaultsOnInsert: true };
	if (session) options.session = session;

	const account = await LedgerAccount.findOneAndUpdate(
		{ userId, type },
		{
			$setOnInsert: {
				userId,
				type,
				availableBalance: 0,
				pendingBalance: 0,
				holdBalance: 0,
			},
		},
		options,
	);

	return account;
};

/**
 * Credit an account (add funds).
 * @param {number} amount - in KOBO
 */
const creditAccount = async (
	userId,
	userType,
	amount,
	reason,
	orderId,
	metadata = {},
) => {
	if (amount <= 0) throw new Error("Amount must be positive");

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType },
			{
				$inc: { availableBalance: amount },
				$setOnInsert: { pendingBalance: 0, holdBalance: 0 },
			},
			{ upsert: true, new: true, session },
		);

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					contraAccountId: null,
					orderId,
					amount,
					entryType: "CREDIT",
					reason,
					meta: metadata,
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		return {
			success: true,
			entry: entry[0],
			newBalance: account.availableBalance,
		};
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Debit an account (process payout).
 * @param {number} amount - in KOBO
 */
const debitAccount = async (
	userId,
	userType,
	amount,
	reason,
	metadata = {},
) => {
	if (amount <= 0) throw new Error("Amount must be positive");

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, availableBalance: { $gte: amount } },
			{ $inc: { availableBalance: -amount } },
			{ new: true, session },
		);

		if (!account) throw new Error("Insufficient balance or account not found");

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "DEBIT",
					reason,
					meta: metadata,
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		return {
			success: true,
			entry: entry[0],
			newBalance: account.availableBalance,
		};
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Reserve balance for payout (available → pending).
 * @param {number} amount - in KOBO
 */
const reserveBalance = async (userId, userType, amount) => {
	if (amount <= 0) throw new Error("Amount must be positive");

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, availableBalance: { $gte: amount } },
			{ $inc: { availableBalance: -amount, pendingBalance: amount } },
			{ new: true, session },
		);

		if (!account) throw new Error("Insufficient available balance to reserve");

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "DEBIT",
					reason: "PAYOUT_PENDING",
					meta: { action: "reserve_for_payout" },
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		return {
			success: true,
			entry: entry[0],
			availableBalance: account.availableBalance,
			pendingBalance: account.pendingBalance,
		};
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Complete a payout — debit from pendingBalance (money has left the system).
 * Called by webhook on transfer.success.
 * @param {number} amount - in KOBO
 */
const completePayout = async (userId, userType, amount) => {
	if (amount <= 0) throw new Error("Amount must be positive");

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, pendingBalance: { $gte: amount } },
			{ $inc: { pendingBalance: -amount } },
			{ new: true, session },
		);

		if (!account) throw new Error("Insufficient pending balance");

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "DEBIT",
					reason: "PAYOUT",
					meta: { action: "complete_payout" },
					balanceAfter: account.pendingBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		return {
			success: true,
			entry: entry[0],
			pendingBalance: account.pendingBalance,
		};
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Reverse a reserved payout (pending → available).
 * Called on payout cancel or max retries exceeded.
 * @param {number} amount - in KOBO
 */
const reverseReserve = async (
	userId,
	userType,
	amount,
	reason = "User cancelled",
) => {
	if (amount <= 0) throw new Error("Amount must be positive");

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, pendingBalance: { $gte: amount } },
			{ $inc: { pendingBalance: -amount, availableBalance: amount } },
			{ new: true, session },
		);

		if (!account) throw new Error("Insufficient pending balance to reverse");

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "REVERSAL",
					meta: { action: "reverse_payout_reserve", reason },
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		return {
			success: true,
			entry: entry[0],
			availableBalance: account.availableBalance,
			pendingBalance: account.pendingBalance,
		};
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Get account balance.
 * Returns values in KOBO — controllers divide by 100 before sending to frontend.
 */
const getAccountBalance = async (userId, userType) => {
	const account = await LedgerAccount.findOne({ userId, type: userType });
	if (!account) {
		return {
			availableBalance: 0,
			pendingBalance: 0,
			holdBalance: 0,
			totalBalance: 0,
		};
	}

	return {
		accountId: account._id,
		availableBalance: account.availableBalance, // kobo
		pendingBalance: account.pendingBalance, // kobo
		holdBalance: account.holdBalance, // kobo
		totalBalance: account.availableBalance + account.pendingBalance,
		lastUpdated: account.updatedAt,
	};
};

/**
 * Get detailed transaction history.
 * Amounts in entries are in KOBO.
 */
const getTransactionHistory = async (
	userId,
	userType,
	limit = 20,
	skip = 0,
) => {
	const account = await LedgerAccount.findOne({ userId, type: userType });
	if (!account) return { transactions: [], total: 0 };

	const transactions = await LedgerEntry.find({ accountId: account._id })
		.sort({ createdAt: -1 })
		.limit(limit)
		.skip(skip)
		.populate("orderId", "totalPrice status");

	const total = await LedgerEntry.countDocuments({ accountId: account._id });

	return { transactions, total, hasMore: skip + limit < total };
};

/**
 * Credit vendor from successful payment.
 * ⚠️  order.totalPrice and order.deliveryFee MUST be in KOBO.
 * Ensure your Order model and payment webhook pass kobo values.
 */
const creditVendorFromOrder = async (order, commission = 0.1) => {
	const vendorGross = order.totalPrice; // kobo
	const vendorCommission = Math.round(vendorGross * commission);
	const vendorNet = vendorGross - vendorCommission;

	await creditAccount(
		order.vendor,
		"VENDOR",
		vendorNet,
		"ORDER_EARNING",
		order._id,
		{
			gross: vendorGross,
			commission: vendorCommission,
			commissionRate: commission,
		},
	);

	return vendorNet;
};

/**
 * Credit rider from successful payment.
 * ⚠️  deliveryFee MUST be in KOBO.
 */
const creditRiderFromOrder = async (order, deliveryFee) => {
	await creditAccount(
		order.rider,
		"RIDER",
		deliveryFee,
		"ORDER_EARNING",
		order._id,
		{ deliveryFee },
	);
	return deliveryFee;
};

/**
 * Audit statement. Amounts in entries are in KOBO.
 */
const getAccountStatement = async (userId, userType, startDate, endDate) => {
	const account = await LedgerAccount.findOne({ userId, type: userType });
	if (!account) return { entries: [] };

	const entries = await LedgerEntry.find({
		accountId: account._id,
		createdAt: { $gte: startDate, $lte: endDate },
	})
		.sort({ createdAt: 1 })
		.populate("orderId");

	const BUCKET_TRANSFER_REASONS = new Set([
		"PAYOUT_PENDING",
		"REVERSAL",
		"DELIVERY_FEE_HOLD",
		"VENDOR_ORDER_PENDING",
	]);

	let runningBalance = 0;
	const withRunningBalance = entries.map((entry) => {
		const isBucketTransfer = BUCKET_TRANSFER_REASONS.has(entry.reason);
		if (!isBucketTransfer) {
			if (entry.entryType === "CREDIT") runningBalance += entry.amount;
			else runningBalance -= entry.amount;
		}
		return { ...entry.toObject(), runningBalance, isBucketTransfer };
	});

	return {
		account: account.toObject(),
		entries: withRunningBalance,
		statement_period: { startDate, endDate },
	};
};

/**
 * Hold delivery fee in escrow.
 * @param {number} amount - in KOBO
 */
const holdRiderFee = async (userId, amount, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: "RIDER" },
			{
				$inc: { holdBalance: amount },
				$setOnInsert: { availableBalance: 0, pendingBalance: 0 },
			},
			{ upsert: true, new: true, session },
		);

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "DELIVERY_FEE_HOLD",
					orderId,
					meta: { status: "awaiting_token" },
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Release rider fee hold to available on delivery OTP verified.
 * Idempotent — safe to call twice.
 */
const releaseRiderFee = async (userId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(userId, "RIDER", session);

		const alreadyReleased = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "ORDER_EARNING",
			"meta.action": "delivery_fee_released",
		});
		if (alreadyReleased) {
			logger.warn(
				`[WALLET] releaseRiderFee: already released orderId=${orderId} riderId=${userId}`,
			);
			await session.commitTransaction();
			return;
		}

		const holdEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "DELIVERY_FEE_HOLD",
		});

		let amount;
		if (holdEntry) {
			amount = holdEntry.amount;
		} else {
			const Order = require("../models/Order");
			const order = await Order.findById(orderId).select("deliveryFee");
			// deliveryFee must be in kobo in the Order model
			amount = order?.deliveryFee ?? 0;
			if (amount <= 0) {
				await session.commitTransaction();
				return;
			}
		}

		await LedgerAccount.findOneAndUpdate(
			{ _id: account._id },
			{
				$inc: {
					availableBalance: amount,
					...(holdEntry ? { holdBalance: -amount } : {}),
				},
			},
			{ session },
		);

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "ORDER_EARNING",
					orderId,
					meta: { action: "delivery_fee_released" },
					balanceAfter: account.availableBalance + amount,
				},
			],
			{ session },
		);

		await session.commitTransaction();
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Get total earnings for a specific date.
 * Returns value in KOBO.
 */
const getDailyEarnings = async (userId, userType, date = new Date()) => {
	const account = await LedgerAccount.findOne({ userId, type: userType });
	if (!account) return 0;

	const startOfDay = new Date(date);
	startOfDay.setHours(0, 0, 0, 0);

	const endOfDay = new Date(date);
	endOfDay.setHours(23, 59, 59, 999);

	const result = await LedgerEntry.aggregate([
		{
			$match: {
				accountId: account._id,
				entryType: "CREDIT",
				reason: "ORDER_EARNING",
				createdAt: { $gte: startOfDay, $lte: endOfDay },
			},
		},
		{ $group: { _id: null, total: { $sum: "$amount" } } },
	]);

	return result.length > 0 ? result[0].total : 0; // kobo
};

/**
 * Move vendor held earnings to pendingBalance on order accept.
 * Idempotent.
 */
const pendVendorEarning = async (vendorId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(vendorId, "VENDOR", session);

		const alreadyPended = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "VENDOR_ORDER_PENDING",
		});
		if (alreadyPended) {
			logger.warn(
				`[WALLET] pendVendorEarning: already pended orderId=${orderId} vendorId=${vendorId}`,
			);
			await session.commitTransaction();
			return;
		}

		const holdEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "VENDOR_EARNING_HOLD",
		});

		let amount;
		if (holdEntry) {
			amount = holdEntry.amount;
		} else {
			const Order = require("../models/Order");
			const order = await Order.findById(orderId).select(
				"vendorEarning foodTotal items",
			);
			// vendorEarning must be in kobo in the Order model
			amount =
				order?.vendorEarning ??
				order?.items?.reduce((s, i) => s + (i.price ?? 0), 0) ??
				0;
			if (amount <= 0) {
				await session.commitTransaction();
				return;
			}
		}

		await LedgerAccount.findOneAndUpdate(
			{ _id: account._id },
			{
				$inc: {
					pendingBalance: amount,
					...(holdEntry ? { holdBalance: -amount } : {}),
				},
			},
			{ session },
		);

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "VENDOR_ORDER_PENDING",
					orderId,
					meta: {
						action: "vendor_earning_pending",
						from: holdEntry ? "hold" : "direct",
					},
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		logger.info(
			`[WALLET] pendVendorEarning: orderId=${orderId} vendorId=${vendorId} amountKobo=${amount}`,
		);
	} catch (error) {
		await session.abortTransaction();
		logger.error(
			`[WALLET] pendVendorEarning failed: orderId=${orderId} err=${error.message}`,
		);
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Hold vendor meal earnings until delivery confirmed.
 * @param {number} amount - in KOBO
 */
const holdVendorAmount = async (vendorId, amount, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId: vendorId, type: "VENDOR" },
			{
				$inc: { holdBalance: amount },
				$setOnInsert: { availableBalance: 0, pendingBalance: 0 },
			},
			{ upsert: true, new: true, session },
		);

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "VENDOR_EARNING_HOLD",
					orderId,
					meta: { status: "awaiting_delivery", role: "vendor" },
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Release vendor earnings to available on delivery completion.
 * Idempotent.
 */
const releaseVendorAmount = async (vendorId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(vendorId, "VENDOR", session);

		const alreadyReleased = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "ORDER_EARNING",
			"meta.action": "vendor_earning_released",
		});
		if (alreadyReleased) {
			logger.warn(
				`[WALLET] releaseVendorAmount: already released orderId=${orderId} vendorId=${vendorId}`,
			);
			await session.commitTransaction();
			return;
		}

		const pendingEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "VENDOR_ORDER_PENDING",
		});

		let amount, sourceField;

		if (pendingEntry) {
			amount = pendingEntry.amount;
			sourceField = "pendingBalance";
		} else {
			const holdEntry = await LedgerEntry.findOne({
				orderId,
				accountId: account._id,
				reason: "VENDOR_EARNING_HOLD",
			});

			if (!holdEntry) {
				logger.warn(
					`[WALLET] releaseVendorAmount: no pending or hold entry orderId=${orderId} vendorId=${vendorId}`,
				);
				await session.commitTransaction();
				return;
			}

			amount = holdEntry.amount;
			sourceField = "holdBalance";
		}

		await LedgerAccount.findOneAndUpdate(
			{ _id: account._id },
			{ $inc: { availableBalance: amount, [sourceField]: -amount } },
			{ session },
		);

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "ORDER_EARNING",
					orderId,
					meta: {
						action: "vendor_earning_released",
						source: pendingEntry ? "pending" : "hold",
					},
					balanceAfter: account.availableBalance + amount,
				},
			],
			{ session },
		);

		await session.commitTransaction();
	} catch (error) {
		await session.abortTransaction();
		logger.error(
			`[WALLET] releaseVendorAmount failed: orderId=${orderId} vendorId=${vendorId} err=${error.message}`,
		);
		throw error;
	} finally {
		session.endSession();
	}
};

const reverseVendorHold = async (vendorId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(vendorId, "VENDOR", session);
		const holdEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "VENDOR_EARNING_HOLD",
		});

		if (!holdEntry) {
			await session.commitTransaction();
			return;
		}

		const amount = holdEntry.amount;

		await LedgerAccount.findOneAndUpdate(
			{ _id: account._id },
			{ $inc: { holdBalance: -amount } },
			{ session },
		);

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "DEBIT",
					reason: "REVERSAL",
					orderId,
					meta: {
						action: "vendor_earning_hold_reversed",
						reason: "vendor_declined",
					},
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		logger.info(
			`[WALLET] reverseVendorHold: orderId=${orderId} vendorId=${vendorId} amountKobo=${amount}`,
		);
	} catch (error) {
		await session.abortTransaction();
		logger.error(
			`[WALLET] reverseVendorHold failed: orderId=${orderId} err=${error.message}`,
		);
		throw error;
	} finally {
		session.endSession();
	}
};

const reverseRiderFeeHold = async (riderId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(riderId, "RIDER", session);
		const holdEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "DELIVERY_FEE_HOLD",
		});

		if (!holdEntry) {
			await session.commitTransaction();
			return;
		}

		const amount = holdEntry.amount;

		await LedgerAccount.findOneAndUpdate(
			{ _id: account._id },
			{ $inc: { holdBalance: -amount } },
			{ session },
		);

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "DEBIT",
					reason: "REVERSAL",
					orderId,
					meta: {
						action: "delivery_fee_hold_reversed",
						reason: "rider_declined",
					},
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await session.commitTransaction();
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

const reverseOrderEarnings = async (order) => {
	const { vendor: vendorId, rider: riderId, _id: orderId } = order;

	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const vendorAccount = await ensureAccount(vendorId, "VENDOR", session);

		const pendingEntry = await LedgerEntry.findOne({
			orderId,
			accountId: vendorAccount._id,
			reason: "VENDOR_ORDER_PENDING",
		});

		const holdEntry =
			!pendingEntry &&
			(await LedgerEntry.findOne({
				orderId,
				accountId: vendorAccount._id,
				reason: "VENDOR_EARNING_HOLD",
			}));

		const vendorEntry = pendingEntry || holdEntry;
		if (vendorEntry) {
			const amount = vendorEntry.amount;
			const sourceField = pendingEntry ? "pendingBalance" : "holdBalance";

			await LedgerAccount.findOneAndUpdate(
				{ _id: vendorAccount._id },
				{ $inc: { [sourceField]: -amount } },
				{ session },
			);

			await LedgerEntry.create(
				[
					{
						accountId: vendorAccount._id,
						amount,
						entryType: "DEBIT",
						reason: "REVERSAL",
						orderId,
						meta: {
							action: "order_cancelled",
							source: pendingEntry ? "pending" : "hold",
						},
						balanceAfter: vendorAccount.availableBalance,
					},
				],
				{ session },
			);

			logger.info(
				`[WALLET] reverseOrderEarnings vendor: orderId=${orderId} amountKobo=${amount} from=${sourceField}`,
			);
		}

		await session.commitTransaction();
	} catch (error) {
		await session.abortTransaction();
		logger.error(
			`[WALLET] reverseOrderEarnings vendor failed: orderId=${orderId} err=${error.message}`,
		);
	} finally {
		session.endSession();
	}

	if (riderId) {
		try {
			await reverseRiderFeeHold(riderId, orderId);
		} catch (error) {
			logger.error(
				`[WALLET] reverseOrderEarnings rider failed: orderId=${orderId} err=${error.message}`,
			);
		}
	}
};

module.exports = {
	ensureAccount,
	creditAccount,
	debitAccount,
	reserveBalance,
	completePayout,
	reverseReserve,
	getAccountBalance,
	getTransactionHistory,
	creditVendorFromOrder,
	creditRiderFromOrder,
	getAccountStatement,
	holdRiderFee,
	releaseRiderFee,
	reverseRiderFeeHold,
	reverseVendorHold,
	reverseOrderEarnings,
	holdVendorAmount,
	pendVendorEarning,
	releaseVendorAmount,
	getDailyEarnings,
};
