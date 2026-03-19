const { LedgerEntry, LedgerAccount } = require("../models");
const mongoose = require("mongoose");

/**
 * Ledger Service - Double-entry bookkeeping for payments
 *
 * Flow:
 * 1. Order paid → Credit vendor/rider accounts
 * 2. Vendor/Rider requests payout → Debit from available, move to pending
 * 3. Payout processed → Debit from pending (finalizes money out)
 */

/**
 * Ensure ledger accounts exist for a user
 */
const ensureAccount = async (userId, type) => {
	let account = await LedgerAccount.findOne({ userId, type });
	if (!account) {
		account = await LedgerAccount.create({
			userId,
			type,
			availableBalance: 0,
			pendingBalance: 0,
			holdBalance: 0,
		});
	}
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
		// Ensure account exists
		const account = await ensureAccount(userId, userType);

		// Create ledger entry
		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					contraAccountId: null, // Platform account (implicit)
					orderId,
					amount,
					entryType: "CREDIT",
					reason,
					meta: metadata,
					balanceAfter: account.availableBalance + amount,
				},
			],
			{ session },
		);

		// Update available balance
		account.availableBalance += amount;
		await account.save({ session });

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
		const account = await ensureAccount(userId, userType);

		// Check sufficient balance
		if (account.availableBalance < amount) {
			throw new Error(
				`Insufficient balance. Available: ${account.availableBalance}, Requested: ${amount}`,
			);
		}

		// Create ledger entry
		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					contraAccountId: null,
					amount,
					entryType: "DEBIT",
					reason,
					meta: metadata,
					balanceAfter: account.availableBalance - amount,
				},
			],
			{ session },
		);

		// Update balance
		account.availableBalance -= amount;
		await account.save({ session });

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
		const account = await ensureAccount(userId, userType);

		if (account.availableBalance < amount) {
			throw new Error(`Insufficient available balance to reserve`);
		}

		// Create ledger entry marking it as PENDING_PAYOUT
		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "DEBIT", // Reserve = debit from available
					reason: "PAYOUT_PENDING",
					meta: { action: "reserve_for_payout" },
					balanceAfter: account.availableBalance - amount,
				},
			],
			{ session },
		);

		// Move from available to pending
		account.availableBalance -= amount;
		account.pendingBalance += amount;
		await account.save({ session });

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
		const account = await ensureAccount(userId, userType);

		if (account.pendingBalance < amount) {
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
					balanceAfter: 0, // Pending → 0 (money left system)
				},
			],
			{ session },
		);

		account.pendingBalance -= amount;
		await account.save({ session });

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
		const account = await ensureAccount(userId, userType);

		if (account.pendingBalance < amount) {
			throw new Error(`Insufficient pending balance to reverse`);
		}

		const entry = await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT", // Reversal = credit back
					reason: "REVERSAL",
					meta: { action: "reverse_payout_reserve", reason },
					balanceAfter: account.availableBalance + amount,
				},
			],
			{ session },
		);

		account.pendingBalance -= amount;
		account.availableBalance += amount;
		await account.save({ session });

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

	// Credit vendor with net amount (after commission)
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

	// Calculate running balance
	let runningBalance = 0;
	const withRunningBalance = entries.map((entry) => {
		if (entry.entryType === "CREDIT") {
			runningBalance += entry.amount;
		} else {
			runningBalance -= entry.amount;
		}
		return { ...entry.toObject(), runningBalance };
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
		const account = await ensureAccount(userId, "RIDER");

		// Create entry marking it as ON_HOLD
		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "DELIVERY_FEE_HOLD",
					orderId,
					meta: { status: "awaiting_token" },
					balanceAfter: account.availableBalance, // Available doesn't change yet
				},
			],
			{ session },
		);

		account.holdBalance += amount; // Increases hold, not available
		await account.save({ session });

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
 */
const releaseRiderFee = async (userId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(userId, "RIDER");

		// Check for a pre-existing hold entry (created at payment time if rider was
		// already assigned). In the standard flow the rider is assigned AFTER payment,
		// so holdEntry will be null — we fall back to crediting directly from the order.
		const holdEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "DELIVERY_FEE_HOLD",
		});

		let amount;
		if (holdEntry) {
			// Release from hold
			amount = holdEntry.amount;
			account.holdBalance = Math.max(0, account.holdBalance - amount);
		} else {
			// No hold was created (rider assigned after payment) — look up delivery fee
			// from the order and credit directly
			const Order = require("../models/Order");
			const order = await Order.findById(orderId).select("deliveryFee");
			amount = order?.deliveryFee ?? 0;
			if (amount <= 0) {
				// Nothing to credit — commit empty transaction and exit
				await session.commitTransaction();
				return;
			}
		}

		account.availableBalance += amount;

		await LedgerEntry.create(
			[
				{
					accountId: account._id,
					amount,
					entryType: "CREDIT",
					reason: "ORDER_EARNING",
					orderId,
					meta: { action: "delivery_fee_released" },
					balanceAfter: account.availableBalance,
				},
			],
			{ session },
		);

		await account.save({ session });
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
 * Hold vendor's meal earnings until delivery is confirmed.
 * Called by payment webhook instead of immediately crediting.
 */
const holdVendorAmount = async (vendorId, amount, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(vendorId, "VENDOR");

		await LedgerEntry.create(
			[{
				accountId: account._id,
				amount,
				entryType: "CREDIT",
				reason: "DELIVERY_FEE_HOLD",
				orderId,
				meta: { status: "awaiting_delivery", role: "vendor" },
				balanceAfter: account.availableBalance, // available unchanged
			}],
			{ session },
		);

		account.holdBalance += amount;
		await account.save({ session });
		await session.commitTransaction();
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		session.endSession();
	}
};

/**
 * Release vendor's held earnings to withdrawable (availableBalance).
 * Called when delivery OTP is confirmed.
 */
const releaseVendorAmount = async (vendorId, orderId) => {
	const session = await mongoose.startSession();
	session.startTransaction();
	try {
		const account = await ensureAccount(vendorId, "VENDOR");

		const holdEntry = await LedgerEntry.findOne({
			orderId,
			accountId: account._id,
			reason: "DELIVERY_FEE_HOLD",
		});

		let amount;
		if (holdEntry) {
			amount = holdEntry.amount;
			account.holdBalance = Math.max(0, account.holdBalance - amount);
		} else {
			// No hold exists (legacy order credited immediately via webhook) — nothing to release
			await session.commitTransaction();
			return;
		}

		account.availableBalance += amount;

		await LedgerEntry.create(
			[{
				accountId: account._id,
				amount,
				entryType: "CREDIT",
				reason: "ORDER_EARNING",
				orderId,
				meta: { action: "vendor_earning_released" },
				balanceAfter: account.availableBalance,
			}],
			{ session },
		);

		await account.save({ session });
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
	holdVendorAmount,
	releaseVendorAmount,
	getDailyEarnings,
};
