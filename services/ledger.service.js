const { LedgerEntry, LedgerAccount } = require("../models");
const mongoose = require("mongoose");
const logger = require("../utils/logger"); // ✅ FIX #6: logger imported

/**
 * Ledger Service - Double-entry bookkeeping for payments
 *
 * Flow:
 * 1. Order paid → Hold vendor/rider earnings
 * 2. Vendor accepts → pendVendorEarning (hold → pending)
 * 3. Delivery OTP verified → releaseVendorAmount + releaseRiderFee (→ available)
 * 4. Vendor/Rider requests payout → reserveBalance (available → pending)
 * 5. Payout processed → completePayout (pending → out)
 */

/**
 * Ensure ledger accounts exist for a user (atomic upsert)
 * ✅ FIX #5: replaced findOne+create with findOneAndUpdate upsert to prevent duplicate accounts
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
 * Credit an account (add funds)
 * entryType: CREDIT = money in
 * reason: ORDER_EARNING, ADJUSTMENT, REFUND, REVERSAL
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
		// ✅ FIX #1: atomic $inc update instead of read-modify-write to prevent race conditions
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
 * Debit an account (process payout)
 * entryType: DEBIT = money out
 * reason: PAYOUT, COMMISSION (platform fees)
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
		// ✅ FIX #1: atomic conditional decrement — only succeeds if balance is sufficient
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, availableBalance: { $gte: amount } },
			{ $inc: { availableBalance: -amount } },
			{ new: true, session },
		);

		if (!account) {
			throw new Error(`Insufficient balance or account not found`);
		}

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					contraAccountId: null,
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
 * Move balance from available to pending (user requests payout)
 * Ensures funds are reserved and can't be double-spent
 */
const reserveBalance = async (userId, userType, amount) => {
	if (amount <= 0) throw new Error("Amount must be positive");

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		// ✅ FIX #1: atomic conditional update
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, availableBalance: { $gte: amount } },
			{ $inc: { availableBalance: -amount, pendingBalance: amount } },
			{ new: true, session },
		);

		if (!account) {
			throw new Error(`Insufficient available balance to reserve`);
		}

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
 * Complete a payout (debit from pending balance)
 * Called after money has been successfully sent to user's bank
 */
const completePayout = async (userId, userType, amount) => {
	if (amount <= 0) throw new Error("Amount must be positive");

	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		// ✅ FIX #1: atomic conditional decrement on pendingBalance
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, pendingBalance: { $gte: amount } },
			{ $inc: { pendingBalance: -amount } },
			{ new: true, session },
		);

		if (!account) {
			throw new Error(`Insufficient pending balance`);
		}

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "DEBIT",
					reason: "PAYOUT",
					meta: { action: "complete_payout" },
					balanceAfter: account.pendingBalance, // ✅ FIX #4: actual remaining pendingBalance, not hardcoded 0
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
 * Reverse a reserved payout (e.g., payout request cancelled or failed)
 * Moves balance back from pending to available
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
		// ✅ FIX #1: atomic conditional update
		const account = await LedgerAccount.findOneAndUpdate(
			{ userId, type: userType, pendingBalance: { $gte: amount } },
			{ $inc: { pendingBalance: -amount, availableBalance: amount } },
			{ new: true, session },
		);

		if (!account) {
			throw new Error(`Insufficient pending balance to reverse`);
		}

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
 * Get account balance and transaction history
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
		availableBalance: account.availableBalance,
		pendingBalance: account.pendingBalance,
		holdBalance: account.holdBalance,
		totalBalance: account.availableBalance + account.pendingBalance,
		lastUpdated: account.updatedAt,
	};
};

/**
 * Get detailed transaction history
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
 * Credit vendor from successful payment
 * Called by webhook when payment succeeds
 */
const creditVendorFromOrder = async (order, commission = 0.1) => {
	const vendorGross = order.totalPrice;
	const vendorCommission = vendorGross * commission;
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
 * Credit rider from successful payment
 * Called by webhook when payment succeeds
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
 * Audit: Get all ledger entries for reconciliation
 * ✅ FIX #5: running balance now accounts for bucket-transfer entries (PAYOUT_PENDING, REVERSAL, etc.)
 * that move money between balances without changing net worth
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

	// Bucket-transfer reasons move money between buckets but don't change net balance
	const BUCKET_TRANSFER_REASONS = new Set([
		"PAYOUT_PENDING", // available → pending (reserve)
		"REVERSAL", // pending → available (unreserve)
		"DELIVERY_FEE_HOLD", // → holdBalance
		"VENDOR_ORDER_PENDING", // hold → pending
	]);

	// ✅ FIX #5: only count entries that affect net balance (i.e. real money in/out)
	let runningBalance = 0;
	const withRunningBalance = entries.map((entry) => {
		const isBucketTransfer = BUCKET_TRANSFER_REASONS.has(entry.reason);

		if (!isBucketTransfer) {
			if (entry.entryType === "CREDIT") {
				runningBalance += entry.amount;
			} else {
				runningBalance -= entry.amount;
			}
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
 * 1. Hold Delivery Fee (Escrow)
 * Called by Webhook: Money is deducted from the platform but not yet available to the rider.
 */
const holdRiderFee = async (userId, amount, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		// ✅ FIX #1: atomic $inc
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
 * 2. Release Hold to Available (Token Verified)
 * Called by orderController.verifyDeliveryOtp
 * ✅ FIX #2: idempotency guard — will not double-credit if called twice
 */
const releaseRiderFee = async (userId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(userId, "RIDER", session);

		// ✅ FIX #2: idempotency check — bail if already released for this order
		const alreadyReleased = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "ORDER_EARNING",
			"meta.action": "delivery_fee_released",
		});
		if (alreadyReleased) {
			logger.warn(
				`[WALLET] releaseRiderFee: already released for orderId=${orderId} riderId=${userId}`,
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
			amount = order?.deliveryFee ?? 0;
			if (amount <= 0) {
				await session.commitTransaction();
				return;
			}
		}

		// ✅ FIX #1: atomic update
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
 * Get total earnings for a specific date (default: today)
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
		{
			$group: {
				_id: null,
				total: { $sum: "$amount" },
			},
		},
	]);

	return result.length > 0 ? result[0].total : 0;
};

/**
 * Move vendor's held earnings (holdBalance) to pendingBalance when vendor accepts the order.
 * ✅ FIX #2: idempotency guard added
 * ✅ FIX #1: atomic updates
 */
const pendVendorEarning = async (vendorId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(vendorId, "VENDOR", session);

		// ✅ FIX #2: idempotency — bail if already pended
		const alreadyPended = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "VENDOR_ORDER_PENDING",
		});
		if (alreadyPended) {
			logger.warn(
				`[WALLET] pendVendorEarning: already pended for orderId=${orderId} vendorId=${vendorId}`,
			);
			await session.commitTransaction();
			return;
		}

		const holdEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "VENDOR_EARNING_HOLD", // ✅ dedicated reason, not shared with rider
		});

		let amount;
		if (holdEntry) {
			amount = holdEntry.amount;
		} else {
			const Order = require("../models/Order");
			const order = await Order.findById(orderId).select(
				"vendorEarning foodTotal items",
			);
			amount =
				order?.vendorEarning ??
				order?.items?.reduce((s, i) => s + (i.price ?? 0), 0) ??
				0;
			if (amount <= 0) {
				await session.commitTransaction();
				return;
			}
		}

		// ✅ FIX #1: atomic update
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
			`[WALLET] pendVendorEarning: orderId=${orderId} vendorId=${vendorId} amount=${amount}`,
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
 * Hold vendor's meal earnings until delivery is confirmed.
 * ✅ FIX: uses dedicated reason "VENDOR_EARNING_HOLD" (not shared with rider's "DELIVERY_FEE_HOLD")
 * ✅ FIX #1: atomic update
 */
const holdVendorAmount = async (vendorId, amount, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		// ✅ FIX #1: atomic $inc
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
					reason: "VENDOR_EARNING_HOLD", // ✅ FIX: dedicated reason
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
 * Release vendor's earnings to availableBalance on delivery completion.
 * ✅ FIX #2: idempotency guard
 * ✅ FIX #1: atomic updates
 */
const releaseVendorAmount = async (vendorId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(vendorId, "VENDOR", session);

		// ✅ FIX #2: idempotency — bail if already released
		const alreadyReleased = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "ORDER_EARNING",
			"meta.action": "vendor_earning_released",
		});
		if (alreadyReleased) {
			logger.warn(
				`[WALLET] releaseVendorAmount: already released for orderId=${orderId} vendorId=${vendorId}`,
			);
			await session.commitTransaction();
			return;
		}

		const pendingEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "VENDOR_ORDER_PENDING",
		});

		let amount;
		let sourceField;

		if (pendingEntry) {
			amount = pendingEntry.amount;
			sourceField = "pendingBalance";
			logger.info(
				`[WALLET] releaseVendorAmount (pending→available): orderId=${orderId} vendorId=${vendorId} amount=${amount}`,
			);
		} else {
			const holdEntry = await LedgerEntry.findOne({
				orderId,
				accountId: account._id,
				reason: "VENDOR_EARNING_HOLD", // ✅ updated reason
			});

			if (!holdEntry) {
				logger.warn(
					`[WALLET] releaseVendorAmount: no pending or hold entry found for orderId=${orderId} vendorId=${vendorId}`,
				);
				await session.commitTransaction();
				return;
			}

			amount = holdEntry.amount;
			sourceField = "holdBalance";
			logger.info(
				`[WALLET] releaseVendorAmount (hold→available fallback): orderId=${orderId} vendorId=${vendorId} amount=${amount}`,
			);
		}

		// ✅ FIX #1: atomic update
		await LedgerAccount.findOneAndUpdate(
			{ _id: account._id },
			{
				$inc: {
					availableBalance: amount,
					[sourceField]: -amount,
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

/**
 * Reverse a delivery fee hold — called when a rider declines after accepting.
 * ✅ FIX #1: atomic update
 */
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

		// ✅ FIX #1: atomic update
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
	holdVendorAmount,
	pendVendorEarning,
	releaseVendorAmount,
	getDailyEarnings,
};
