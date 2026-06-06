const ledgerService = require("../services/ledger.service");
const { Payout, User } = require("../models");
const payoutService = require("../services/payout.service");
const RiderProfile = require("../models/RiderProfile");
const VendorProfile = require("../models/VendorProfile");
const logger = require("../utils/logger");

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Resolve profile _id and recipientType from req.user.
 * Vendors use `owner`, riders use `user`.
 */
const resolveRecipient = async (userId, userType) => {
	if (userType === "vendor") {
		const vp = await VendorProfile.findOne({ owner: userId });
		if (!vp) return null;
		return { profileId: vp._id, recipientType: "VendorProfile" };
	}
	const rp = await RiderProfile.findOne({ user: userId });
	if (!rp) return null;
	return { profileId: rp._id, recipientType: "RiderProfile" };
};

/**
 * Shape a payout document for API response.
 * All amounts already in naira — no conversion needed.
 */
const formatPayout = (p) => ({
	payoutId: p._id,
	reference: p.reference,
	amount: p.amount,
	feeDeducted: p.feeDeducted,
	netAmount: p.netAmount,
	status: p.status,
	transactionRef: p.transactionRef,
	processAt: p.processAt,
	requestedAt: p.createdAt,
	processedAt: p.processedAt,
	failureReason: p.failureReason,
});

// ─── CONTROLLERS ──────────────────────────────────────────────────────────────

const isTestPhone = (phone) => {
	if (!phone) return false;
	const cleanPhone = phone.replace(/[^0-9]/g, "");
	return cleanPhone.endsWith("8022000008") || cleanPhone.endsWith("8022000009");
};

/**
 * GET /api/payouts/balance
 * Returns balance in naira directly from ledger.
 */
const getBalance = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view balances" });
		}

		// Intercept test account to show test balance
		const userDoc = await User.findById(userId);
		if (userDoc && isTestPhone(userDoc.phone)) {
			return res.json({
				availableBalance: 25000,
				holdBalance: 0,
				pendingBalance: 0,
				totalEarnings: 25000,
			});
		}

		const recipient = await resolveRecipient(userId, userType);
		if (!recipient)
			return res.status(404).json({ error: `${userType} profile not found` });

		const balance = await ledgerService.getAccountBalance(
			recipient.profileId,
			userType.toUpperCase(),
		);

		const totalEarnings =
			(balance.availableBalance ?? 0) +
			(balance.holdBalance ?? 0) +
			(balance.pendingBalance ?? 0);

		res.json({ ...balance, totalEarnings });
	} catch (err) {
		logger.error("[getBalance]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * GET /api/payouts/history?limit=20&skip=0
 */
const getTransactionHistory = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;
		const { limit = 20, skip = 0 } = req.query;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view history" });
		}

		const recipient = await resolveRecipient(userId, userType);
		if (!recipient)
			return res.status(404).json({ error: `${userType} profile not found` });

		const history = await ledgerService.getTransactionHistory(
			recipient.profileId,
			userType.toUpperCase(),
			parseInt(limit),
			parseInt(skip),
		);

		res.json(history);
	} catch (err) {
		logger.error("[getTransactionHistory]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * POST /api/payouts/request
 * Body: { amount (naira), bankDetails: { accountNumber, bankCode, accountName, bankName } }
 */
const requestPayout = async (req, res) => {
	logger.info("[requestPayout] START", {
		userId: req.user?.id,
		body: req.body,
	});
	try {
		const { id: userId, role: userType } = req.user;
		const { amount, bankDetails } = req.body;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can request payouts" });
		}

		// Intercept test account to block actual withdrawal
		const userDoc = await User.findById(userId);
		if (userDoc && isTestPhone(userDoc.phone)) {
			return res
				.status(400)
				.json({ error: "This is test money and cannot be withdrawn." });
		}
		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Amount must be greater than 0" });
		}
		if (!bankDetails?.accountNumber || !bankDetails?.bankCode) {
			return res
				.status(400)
				.json({ error: "Bank details are required (accountNumber, bankCode)" });
		}

		// amount comes in as naira from frontend — pass directly, no conversion
		const result = await payoutService.requestWithdrawal({
			userId,
			userType: userType.toUpperCase(),
			amount, // naira
			bankDetails,
			name: bankDetails.accountName || "",
		});

		if (!result.success) {
			const statusMap = {
				invalid_amount: 400,
				no_bank: 400,
				profile_not_found: 404,
				insufficient_funds: 400,
				platform_balance_insufficient: 503,
				withdrawal_in_progress: 409,
			};
			return res.status(statusMap[result.reason] || 500).json({
				error: result.detail || result.reason,
				reason: result.reason,
				...(result.availableBalance != null && {
					availableBalance: result.availableBalance,
				}),
				...(result.fees && { fees: result.fees }),
				...(result.payout && { payout: formatPayout(result.payout) }),
			});
		}

		const holdMinutes = Math.round(payoutService.WITHDRAWAL_HOLD_MS / 60000);
		const holdDisplay =
			holdMinutes < 60 ? `${holdMinutes} minutes` : `${holdMinutes / 60} hours`;

		return res.status(201).json({
			message: `Withdrawal queued. Funds will be transferred in approximately ${holdDisplay}.`,
			payout: formatPayout(result.payout),
			fees: {
				grossAmount: amount,
				paystackFee: result.fees.paystackFee,
				stampDuty: result.fees.stampDuty,
				totalFee: result.fees.total,
				totalDeducted: amount,
				netAmountSent: Math.max(0, amount - result.fees.total),
			},
		});
	} catch (err) {
		logger.error("[requestPayout] CRASHED", {
			message: err.message,
			stack: err.stack,
		});
		res.status(500).json({ error: err.message });
	}
};

/**
 * GET /api/payouts/fee-estimate?amount=5000
 * Returns fee breakdown for a given naira amount before the user confirms.
 */
const getFeeEstimate = async (req, res) => {
	try {
		const amount = parseFloat(req.query.amount);

		if (!amount || amount <= 0) {
			return res
				.status(400)
				.json({ error: "amount query param required and must be > 0" });
		}

		const fees = payoutService.calculateFees(amount);

		return res.json({
			grossAmount: amount,
			paystackFee: fees.paystackFee,
			stampDuty: fees.stampDuty,
			totalFee: fees.total,
			totalDeducted: amount,
			netAmountSent: Math.max(0, amount - fees.total),
		});
	} catch (err) {
		logger.error("[getFeeEstimate]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * GET /api/payouts/pending
 */
const getPendingPayouts = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view payouts" });
		}

		const recipient = await resolveRecipient(userId, userType);
		if (!recipient)
			return res.status(404).json({ error: `${userType} profile not found` });

		const payouts = await Payout.find({
			recipientId: recipient.profileId,
			recipientType: recipient.recipientType,
			status: { $in: ["pending", "processing"] },
		}).sort({ createdAt: -1 });

		res.json(payouts.map(formatPayout));
	} catch (err) {
		logger.error("[getPendingPayouts]", { message: err.message });
		res.status(500).json({ error: err.message });
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

		if (payout.status !== "pending") {
			return res.status(400).json({
				error: `Cannot cancel a withdrawal with status '${payout.status}'. Only pending withdrawals can be cancelled.`,
			});
		}

		if (userType !== "admin") {
			const recipient = await resolveRecipient(userId, userType);
			if (!recipient)
				return res.status(404).json({ error: `${userType} profile not found` });
			if (payout.recipientId.toString() !== recipient.profileId.toString()) {
				return res.status(403).json({ error: "Unauthorized" });
			}
		}

		const ledgerType =
			payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";
		const reversed = await ledgerService.reverseReserve(
			payout.recipientId,
			ledgerType,
			payout.amount,
			"Withdrawal cancelled by user",
		);

		payout.status = "cancelled";
		await payout.save();

		res.json({
			message:
				"Withdrawal cancelled. Funds have been returned to your available balance.",
			payout: formatPayout(payout),
			updatedBalance: {
				availableBalance: reversed.availableBalance,
				pendingBalance: reversed.pendingBalance,
			},
		});
	} catch (err) {
		logger.error("[cancelPayout]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * PUT /api/payouts/:payoutId/process  (admin)
 */
const processPayout = async (req, res) => {
	try {
		const { payoutId } = req.params;
		const { transactionRef, status = "success" } = req.body;

		if (req.user.role !== "admin") {
			return res
				.status(403)
				.json({ error: "Only admins can manually process payouts" });
		}

		const payout = await Payout.findById(payoutId);
		if (!payout) return res.status(404).json({ error: "Payout not found" });

		if (!["pending", "processing", "failed"].includes(payout.status)) {
			return res.status(400).json({
				error: `Cannot manually process payout with status '${payout.status}'`,
			});
		}

		const ledgerType =
			payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";

		if (status === "failed") {
			const reversed = await ledgerService.reverseReserve(
				payout.recipientId,
				ledgerType,
				payout.amount,
				`Admin marked failed: ${transactionRef}`,
			);
			payout.status = "failed";
			payout.transactionRef = transactionRef;
			payout.processedAt = new Date();
			await payout.save();

			return res.json({
				message:
					"Payout marked as failed. Funds returned to available balance.",
				payout: formatPayout(payout),
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
		payout.status = "success";
		payout.transactionRef = transactionRef;
		payout.processedAt = new Date();
		await payout.save();

		res.json({
			message: "Payout marked as successful.",
			payout: formatPayout(payout),
			updatedBalance: { pendingBalance: completed.pendingBalance },
		});
	} catch (err) {
		logger.error("[processPayout]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * POST /api/payouts/:payoutId/retry  (admin)
 */
const retryPayout = async (req, res) => {
	try {
		if (req.user.role !== "admin") {
			return res.status(403).json({ error: "Only admins can retry payouts" });
		}

		const { payoutId } = req.params;
		const payout = await Payout.findById(payoutId);
		if (!payout) return res.status(404).json({ error: "Payout not found" });

		if (!["failed", "pending"].includes(payout.status)) {
			return res
				.status(400)
				.json({ error: `Cannot retry payout with status '${payout.status}'` });
		}

		await Payout.findByIdAndUpdate(payoutId, {
			$set: { status: "pending", processAt: new Date(), retryCount: 0 },
			$unset: { lockedAt: "", failureReason: "" },
		});

		res.json({
			message: "Payout requeued for immediate processing on next cron run.",
		});
	} catch (err) {
		logger.error("[retryPayout]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * GET /api/payouts/withdrawals
 */
const getPayoutHistory = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;
		const { page = 1, limit = 10 } = req.query;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view payout history" });
		}

		const recipient = await resolveRecipient(userId, userType);
		if (!recipient)
			return res.status(404).json({ error: `${userType} profile not found` });

		const query = {
			recipientId: recipient.profileId,
			recipientType: recipient.recipientType,
		};

		const [history, count] = await Promise.all([
			Payout.find(query)
				.sort({ createdAt: -1 })
				.limit(Number(limit))
				.skip((Number(page) - 1) * Number(limit)),
			Payout.countDocuments(query),
		]);

		res.json({
			success: true,
			data: history.map(formatPayout),
			pagination: {
				total: count,
				pages: Math.ceil(count / Number(limit)),
				currentPage: Number(page),
			},
		});
	} catch (err) {
		logger.error("[getPayoutHistory]", { message: err.message });
		res.status(500).json({ success: false, message: err.message });
	}
};

/**
 * GET /api/payouts/statement?startDate=&endDate=
 */
const getStatement = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;
		const { startDate, endDate } = req.query;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view statements" });
		}
		if (!startDate || !endDate) {
			return res
				.status(400)
				.json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
		}

		const recipient = await resolveRecipient(userId, userType);
		if (!recipient)
			return res.status(404).json({ error: `${userType} profile not found` });

		const statement = await ledgerService.getAccountStatement(
			recipient.profileId,
			userType.toUpperCase(),
			new Date(startDate),
			new Date(endDate),
		);

		res.json(statement);
	} catch (err) {
		logger.error("[getStatement]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

module.exports = {
	getBalance,
	getTransactionHistory,
	requestPayout,
	getFeeEstimate,
	getPendingPayouts,
	cancelPayout,
	processPayout,
	retryPayout,
	getStatement,
	getPayoutHistory,
};
