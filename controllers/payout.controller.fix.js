const ledgerService = require("../services/ledger.service");
const { Payout } = require("../models");
const payoutService = require("../services/payout.service");
const RiderProfile = require("../models/RiderProfile");
const VendorProfile = require("../models/VendorProfile");
const logger = require("../utils/logger"); // FIX-1: was missing — caused ReferenceError crash on every requestPayout call

// ─── SHARED HELPER ────────────────────────────────────────────────────────────

/**
 * Resolve { profileId, recipientType } from userId + role string.
 * Centralised so all handlers share one lookup instead of
 * repeating the VendorProfile/RiderProfile if-else everywhere.
 */
const _resolveProfile = async (userId, userType) => {
	if (userType === "vendor") {
		const vp = await VendorProfile.findOne({ owner: userId }).select("_id");
		return vp ? { profileId: vp._id, recipientType: "VendorProfile" } : null;
	}
	const rp = await RiderProfile.findOne({ user: userId }).select("_id");
	return rp ? { profileId: rp._id, recipientType: "RiderProfile" } : null;
};

// ─── CONTROLLERS ──────────────────────────────────────────────────────────────

/**
 * GET /api/payouts/balance
 */
const getBalance = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;

		if (!["rider", "vendor"].includes(userType))
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view balances" });

		const resolved = await _resolveProfile(userId, userType);
		if (!resolved)
			return res.status(404).json({ error: `${userType} profile not found` });

		const balance = await ledgerService.getAccountBalance(
			resolved.profileId,
			userType.toUpperCase(),
		);

		res.json({
			...balance,
			totalEarnings:
				(balance.availableBalance ?? 0) +
				(balance.holdBalance ?? 0) +
				(balance.pendingBalance ?? 0),
		});
	} catch (error) {
		logger.error("getBalance error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * GET /api/payouts/history?limit=20&skip=0
 * Ledger history — all credits and debits
 */
const getTransactionHistory = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;
		const { limit = 20, skip = 0 } = req.query;

		if (!["rider", "vendor"].includes(userType))
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view history" });

		const resolved = await _resolveProfile(userId, userType);
		if (!resolved)
			return res.status(404).json({ error: `${userType} profile not found` });

		const history = await ledgerService.getTransactionHistory(
			resolved.profileId,
			userType.toUpperCase(),
			parseInt(limit),
			parseInt(skip),
		);

		res.json(history);
	} catch (error) {
		logger.error("getTransactionHistory error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * POST /api/payouts/request
 * Body: { amount, withdrawalType?, bankDetails: { accountNumber, bankCode, accountName, bankName } }
 *
 * FIX-2: instant fee now comes OUT of what the user receives, not added on top.
 *   Before: wallet debited amount + 100, user needed more balance than they asked to withdraw
 *   After:  wallet debited exactly `amount`, user receives `amount - 100` at their bank
 *
 * FIX-3: fee calculation is single-source.
 *   Controller owns instantFee. Service owns Paystack transfer fee (calculateTotalFees).
 *   They run on different bases so they never double-stack on the same number.
 */
const requestPayout = async (req, res) => {
	logger.info("[requestPayout] STEP 1 — hit", { body: req.body });
	try {
		const { id: userId, role: userType } = req.user;
		const { amount, bankDetails, withdrawalType = "next_day" } = req.body;

		logger.info("[requestPayout] STEP 2 — parsed", {
			userId,
			userType,
			amount,
			withdrawalType,
		});

		if (!["rider", "vendor"].includes(userType))
			return res
				.status(403)
				.json({ error: "Only riders and vendors can request payouts" });
		if (!amount || amount <= 0)
			return res.status(400).json({ error: "Amount must be greater than 0" });
		if (!bankDetails?.accountNumber || !bankDetails?.bankCode)
			return res.status(400).json({ error: "Bank details required" });

		const INSTANT_FEE = 100;
		const instantFee = withdrawalType === "instant" ? INSTANT_FEE : 0;

		// FIX-2: wallet is debited exactly what the user requested.
		// The instant fee is taken from what reaches their bank, not charged on top.
		const amountToDebit = amount; // leaves the wallet
		const amountToTransfer = amount - instantFee; // forwarded to Paystack → bank

		if (amountToTransfer <= 0)
			return res.status(400).json({
				error: `Amount must be greater than the instant withdrawal fee of ₦${INSTANT_FEE}`,
			});

		logger.info("[requestPayout] STEP 3 — resolving profile");

		const resolved = await _resolveProfile(userId, userType);
		if (!resolved) {
			logger.warn("[requestPayout] STEP 4 — profile not found");
			return res.status(404).json({ error: `${userType} profile not found` });
		}

		logger.info("[requestPayout] STEP 4 — profile found", {
			profileId: resolved.profileId,
		});

		const balance = await ledgerService.getAccountBalance(
			resolved.profileId,
			userType.toUpperCase(),
		);

		logger.info("[requestPayout] STEP 5 — balance fetched", {
			availableBalance: balance?.availableBalance,
			amountToDebit,
		});

		// FIX-2: check against amountToDebit only — old code was checking amount + 100
		// which meant a rider with exactly ₦1500 couldn't withdraw ₦1500 instant
		if (balance.availableBalance < amountToDebit) {
			return res.status(400).json({
				error: `Insufficient balance. Available: ₦${balance.availableBalance}`,
				availableBalance: balance.availableBalance,
				...(instantFee > 0 && {
					note: `₦${instantFee} instant fee is deducted from your transfer. You will receive ₦${amountToTransfer} before Paystack fees.`,
				}),
			});
		}

		logger.info("[requestPayout] STEP 6 — calling processSinglePayout", {
			amountToDebit,
			amountToTransfer,
		});

		// FIX-3: pass both amounts so the service knows exactly what to debit
		// from the ledger vs what to send to Paystack. calculateTotalFees in
		// the service runs only on amountToTransfer, not on amountToDebit.
		const result = await payoutService.processSinglePayout({
			userId,
			userType: userType.toUpperCase(),
			amount: amountToDebit, // ledger debit
			transferAmount: amountToTransfer, // Paystack transfer amount
			instantFee,
			bankDetails,
			name: bankDetails.accountName || "",
		});

		logger.info("[requestPayout] STEP 7 — processSinglePayout result", {
			success: result.success,
			reason: result.reason,
		});

		if (!result.success) {
			const statusMap = {
				insufficient_funds: 400,
				duplicate_payout: 409,
				profile_not_found: 404,
				amount_too_low: 400,
				no_bank: 400,
				transfer_failed: 502,
			};
			return res.status(statusMap[result.reason] || 500).json({
				error: result.detail || result.error || result.reason,
				reason: result.reason,
				payout: result.payout,
			});
		}

		logger.info("[requestPayout] STEP 8 — success", {
			payoutId: result.payout._id,
			transferCode: result.payout.transactionRef,
		});

		return res.status(201).json({
			message: "Payout initiated successfully",
			payout: {
				payoutId: result.payout._id,
				requestedAmount: amount,
				instantFee,
				feeDeducted: result.payout.feeDeducted,
				netAmount: result.payout.netAmount,
				withdrawalType,
				status: result.payout.status,
				transactionRef: result.payout.transactionRef,
				requestedAt: result.payout.createdAt,
			},
		});
	} catch (error) {
		logger.error("[requestPayout] CRASHED", {
			message: error.message,
			stack: error.stack,
		});
		res.status(500).json({ error: error.message });
	}
};

/**
 * GET /api/payouts/pending
 */
const getPendingPayouts = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;

		if (!["rider", "vendor"].includes(userType))
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view payouts" });

		const resolved = await _resolveProfile(userId, userType);
		if (!resolved)
			return res.status(404).json({ error: `${userType} profile not found` });

		const payouts = await Payout.find({
			recipientId: resolved.profileId,
			status: { $in: ["pending", "processing"] },
		}).sort({ createdAt: -1 });

		res.json(payouts);
	} catch (error) {
		logger.error("getPendingPayouts error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * PUT /api/payouts/:payoutId/cancel
 */
const cancelPayout = async (req, res) => {
	try {
		const { payoutId } = req.params;
		const { id: userId, role: userType } = req.user;

		const payout = await Payout.findById(payoutId);
		if (!payout) return res.status(404).json({ error: "Payout not found" });

		if (payout.status !== "pending")
			return res
				.status(400)
				.json({ error: `Cannot cancel payout with status: ${payout.status}` });

		if (userType !== "admin") {
			const resolved = await _resolveProfile(userId, userType);
			if (
				!resolved ||
				payout.recipientId.toString() !== resolved.profileId.toString()
			)
				return res.status(403).json({ error: "Unauthorized" });
		}

		const ledgerType =
			payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";

		const reversed = await ledgerService.reverseReserve(
			payout.recipientId,
			ledgerType,
			payout.amount,
			"Payout request cancelled by user",
		);

		payout.status = "cancelled";
		await payout.save();

		res.json({
			message: "Payout request cancelled",
			payout,
			updatedBalance: {
				availableBalance: reversed.availableBalance,
				pendingBalance: reversed.pendingBalance,
			},
		});
	} catch (error) {
		logger.error("cancelPayout error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * PUT /api/payouts/:payoutId/process  (admin)
 */
const processPayout = async (req, res) => {
	try {
		const { payoutId } = req.params;
		const { transactionRef, status = "completed" } = req.body;

		if (req.user.role !== "admin")
			return res.status(403).json({ error: "Only admins can process payouts" });

		const payout = await Payout.findById(payoutId);
		if (!payout) return res.status(404).json({ error: "Payout not found" });

		if (!["pending", "processing"].includes(payout.status))
			return res
				.status(400)
				.json({ error: `Cannot process payout with status: ${payout.status}` });

		const ledgerType =
			payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";

		if (status === "failed") {
			const reversed = await ledgerService.reverseReserve(
				payout.recipientId,
				ledgerType,
				payout.amount,
				`Payout processing failed: ${transactionRef}`,
			);
			payout.status = "failed";
			payout.transactionRef = transactionRef;
			payout.processedAt = new Date();
			await payout.save();
			return res.json({
				message: "Payout marked as failed and balance reversed",
				payout,
				updatedBalance: {
					availableBalance: reversed.availableBalance,
					pendingBalance: reversed.pendingBalance,
				},
			});
		}

		const completed = await ledgerService.completePayout(
			payout.recipientId,
			ledgerType,
			payout.amount,
		);
		payout.status = "completed";
		payout.transactionRef = transactionRef;
		payout.processedAt = new Date();
		await payout.save();

		const finalBalance = await ledgerService.getAccountBalance(
			payout.recipientId,
			ledgerType,
		);

		res.json({
			message: "Payout processed successfully",
			payout,
			updatedBalance: {
				availableBalance: finalBalance.availableBalance,
				pendingBalance: completed.pendingBalance,
			},
		});
	} catch (error) {
		logger.error("processPayout error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * POST /api/payouts/:payoutId/retry  (admin)
 */
const retryPayout = async (req, res) => {
	try {
		if (req.user.role !== "admin")
			return res.status(403).json({ error: "Only admins can retry payouts" });

		const result = await payoutService.processPendingPayout(
			req.params.payoutId,
		);
		if (result?.success)
			return res.json({ message: "Payout retried successfully", result });
		return res.status(400).json({ message: "Payout retry failed", result });
	} catch (error) {
		logger.error("retryPayout error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * GET /api/payouts/withdrawals?page=1&limit=10
 * Bank transfer records from the Payout collection.
 * Distinct from getTransactionHistory which reads the ledger.
 */
const getPayoutHistory = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;
		const { page = 1, limit = 10 } = req.query;

		if (!["rider", "vendor"].includes(userType))
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view payout history" });

		const resolved = await _resolveProfile(userId, userType);
		if (!resolved)
			return res.status(404).json({ error: `${userType} profile not found` });

		const query = {
			recipientId: resolved.profileId,
			recipientType: resolved.recipientType,
		};

		const [history, count] = await Promise.all([
			Payout.find(query)
				.sort({ createdAt: -1 })
				.limit(parseInt(limit))
				.skip((parseInt(page) - 1) * parseInt(limit))
				.exec(),
			Payout.countDocuments(query),
		]);

		res.json({
			success: true,
			data: history,
			pagination: {
				total: count,
				pages: Math.ceil(count / limit),
				currentPage: parseInt(page),
			},
		});
	} catch (error) {
		logger.error("getPayoutHistory error:", error.message);
		res.status(500).json({ success: false, message: error.message });
	}
};

/**
 * GET /api/payouts/statement?startDate=2025-01-01&endDate=2025-12-31
 */
const getStatement = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;
		const { startDate, endDate } = req.query;

		if (!["rider", "vendor"].includes(userType))
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view statements" });

		if (!startDate || !endDate)
			return res
				.status(400)
				.json({ error: "startDate and endDate required (YYYY-MM-DD format)" });

		const resolved = await _resolveProfile(userId, userType);
		if (!resolved)
			return res.status(404).json({ error: `${userType} profile not found` });

		const statement = await ledgerService.getAccountStatement(
			resolved.profileId,
			userType.toUpperCase(),
			new Date(startDate),
			new Date(endDate),
		);

		res.json(statement);
	} catch (error) {
		logger.error("getStatement error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

module.exports = {
	getBalance,
	getTransactionHistory,
	requestPayout,
	getPendingPayouts,
	cancelPayout,
	processPayout,
	retryPayout,
	getStatement,
	getPayoutHistory,
};
