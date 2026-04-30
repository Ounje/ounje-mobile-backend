const ledgerService = require("../services/ledger.service");
const { Payout } = require("../models");
const payoutService = require("../services/payout.service");
const RiderProfile = require("../models/RiderProfile");
const VendorProfile = require("../models/VendorProfile");
const logger = require("../utils/logger");

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const toNaira = (kobo) => (kobo != null ? Math.round(kobo) / 100 : null);

const balanceToNaira = (b) => ({
	...b,
	availableBalance: toNaira(b.availableBalance ?? 0),
	pendingBalance: toNaira(b.pendingBalance ?? 0),
	holdBalance: toNaira(b.holdBalance ?? 0),
	totalBalance: toNaira(b.totalBalance ?? 0),
});

const payoutToNaira = (p) => ({
	payoutId: p._id,
	reference: p.reference,
	amount: toNaira(p.amount),
	feeDeducted: toNaira(p.feeDeducted),
	netAmount: toNaira(p.netAmount),
	status: p.status,
	transactionRef: p.transactionRef,
	processAt: p.processAt,
	requestedAt: p.createdAt,
	processedAt: p.processedAt,
	failureReason: p.failureReason,
});

/**
 * Resolve profile _id from req.user.
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

// ─── CONTROLLERS ──────────────────────────────────────────────────────────────

/**
 * GET /api/payouts/balance
 * Returns balance in NAIRA for display.
 */
const getBalance = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view balances" });
		}

		const recipient = await resolveRecipient(userId, userType);
		if (!recipient)
			return res.status(404).json({ error: `${userType} profile not found` });

		const balance = await ledgerService.getAccountBalance(
			recipient.profileId,
			userType.toUpperCase(),
		);

		const naira = balanceToNaira(balance);
		const totalEarnings =
			(naira.availableBalance ?? 0) +
			(naira.holdBalance ?? 0) +
			(naira.pendingBalance ?? 0);

		res.json({ ...naira, totalEarnings });
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

		const transactions = (history.transactions ?? []).map((tx) => ({
			...(tx.toObject?.() ?? tx),
			amount: toNaira(tx.amount ?? 0),
			balanceAfter: toNaira(tx.balanceAfter ?? 0),
		}));

		res.json({ ...history, transactions });
	} catch (err) {
		logger.error("[getTransactionHistory]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * POST /api/payouts/request
 * Body: { amount (naira), bankDetails: { accountNumber, bankCode, accountName, bankName } }
 *
 * On-demand withdrawal — no instant vs next_day distinction.
 * Funds are validated, reserved, and queued for processing after a 2-hour hold.
 */
const requestPayout = async (req, res) => {
	logger.info("[requestPayout] START", {
		userId: req.user?.id,
		body: req.body,
	});
	try {
		const { id: userId, role: userType } = req.user;
		const { amount: amountNaira, bankDetails } = req.body;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can request payouts" });
		}
		if (!amountNaira || amountNaira <= 0) {
			return res.status(400).json({ error: "Amount must be greater than 0" });
		}
		if (!bankDetails?.accountNumber || !bankDetails?.bankCode) {
			return res
				.status(400)
				.json({ error: "Bank details are required (accountNumber, bankCode)" });
		}

		// Convert frontend naira → kobo for all internal processing
		const amountKobo = Math.round(amountNaira * 100);

		logger.info("[requestPayout] Calling requestWithdrawal", {
			userId,
			userType,
			amountKobo,
			fee: `₦${payoutService.TRANSFER_FEE_KOBO / 100}`,
			holdMinutes: payoutService.WITHDRAWAL_HOLD_MS / 60000,
		});

		const result = await payoutService.requestWithdrawal({
			userId,
			userType: userType.toUpperCase(),
			amountKobo,
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
					availableBalance: toNaira(result.availableBalance),
				}),
				...(result.payout && { payout: payoutToNaira(result.payout) }),
			});
		}

		const holdMinutes = Math.round(payoutService.WITHDRAWAL_HOLD_MS / 60000);

		return res.status(201).json({
			message: `Withdrawal queued. Funds will be transferred in approximately ${holdMinutes < 60 ? holdMinutes + " minutes" : holdMinutes / 60 + " hours"}.`,
			payout: payoutToNaira(result.payout),
			fees: {
				grossAmount: toNaira(amountKobo),
				transferFee: toNaira(payoutService.TRANSFER_FEE_KOBO),
				totalDeducted: toNaira(amountKobo + payoutService.TRANSFER_FEE_KOBO),
				netAmountSent: toNaira(amountKobo),
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

		res.json(payouts.map(payoutToNaira));
	} catch (err) {
		logger.error("[getPendingPayouts]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * PUT /api/payouts/:payoutId/cancel
 * Only cancellable if still pending (processAt not yet reached or not yet locked).
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

		// Ownership check
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
			payout: payoutToNaira(payout),
			updatedBalance: {
				availableBalance: toNaira(reversed.availableBalance),
				pendingBalance: toNaira(reversed.pendingBalance),
			},
		});
	} catch (err) {
		logger.error("[cancelPayout]", { message: err.message });
		res.status(500).json({ error: err.message });
	}
};

/**
 * PUT /api/payouts/:payoutId/process  (admin)
 * Manual admin override to mark a payout as completed or failed.
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
				payout: payoutToNaira(payout),
				updatedBalance: {
					availableBalance: toNaira(reversed.availableBalance),
					pendingBalance: toNaira(reversed.pendingBalance),
				},
			});
		}

		// Mark success — debit pending balance
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
			payout: payoutToNaira(payout),
			updatedBalance: {
				pendingBalance: toNaira(completed.pendingBalance),
			},
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
			return res.status(400).json({
				error: `Cannot retry payout with status '${payout.status}'`,
			});
		}

		// Reset and requeue immediately
		await Payout.findByIdAndUpdate(payoutId, {
			$set: {
				status: "pending",
				processAt: new Date(), // process on next cron run
				retryCount: 0,
			},
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
			data: history.map(payoutToNaira),
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

		const entries = (statement.entries ?? []).map((e) => ({
			...e,
			amount: toNaira(e.amount ?? 0),
			balanceAfter: toNaira(e.balanceAfter ?? 0),
			runningBalance: toNaira(e.runningBalance ?? 0),
		}));

		res.json({ ...statement, entries });
	} catch (err) {
		logger.error("[getStatement]", { message: err.message });
		res.status(500).json({ error: err.message });
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
