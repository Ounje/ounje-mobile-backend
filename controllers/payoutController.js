const ledgerService = require("../services/ledger.service");
const { Payout, User, WithdrawalOtpSession } = require("../models");
const payoutService = require("../services/payout.service");
const RiderProfile = require("../models/RiderProfile");
const VendorProfile = require("../models/VendorProfile");
const logger = require("../utils/logger");
const normalizePhone = require("../utils/phoneNormalizer");
const { requestSmsOtp, verifySmsOtp } = require("../utils/kudiSmsHelper");
const { v4: uuidv4 } = require("uuid");

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

const resolveProfile = async (userId, userType) => {
	if (userType === "vendor") {
		return VendorProfile.findOne({ owner: userId });
	}
	return RiderProfile.findOne({ user: userId });
};

const hasCompleteBankDetails = (bankDetails = {}) =>
	Boolean(bankDetails.accountNumber && bankDetails.bankCode);

const bankDetailsMatchSaved = (submitted = {}, saved = {}) => {
	if (!submitted || Object.keys(submitted).length === 0) return true;
	return (
		String(submitted.accountNumber || "") === String(saved.accountNumber || "") &&
		String(submitted.bankCode || "") === String(saved.bankCode || "")
	);
};

const maskPhone = (phone = "") => {
	const value = String(phone);
	if (value.length <= 4) return "****";
	return `${"*".repeat(Math.max(value.length - 4, 4))}${value.slice(-4)}`;
};

const verifyWithdrawalOtp = async ({ userId, userType, otp, reference }) => {
	if (!otp || !reference) {
		return {
			success: false,
			status: 400,
			error: "Withdrawal OTP and reference are required",
		};
	}

	const user = await User.findById(userId).select("phone");
	if (!user?.phone) {
		return {
			success: false,
			status: 400,
			error: "No phone number is linked to this account",
		};
	}

	const phone = normalizePhone(String(user.phone));
	const session = await WithdrawalOtpSession.findOne({
		user: userId,
		userType,
		phone,
		reference,
	});

	if (!session) {
		return {
			success: false,
			status: 400,
			error: "Invalid or expired withdrawal OTP session",
		};
	}

	const reviewMode = process.env.REVIEW_MODE === "true";
	const isReviewOtp = reviewMode && phone === "8022000001" && otp === "123456";

	if (!isReviewOtp) {
		const verified = await verifySmsOtp(otp, reference);
		if (!verified.success) {
			return {
				success: false,
				status: 400,
				error: verified.error || "Invalid withdrawal OTP",
			};
		}
	}

	await WithdrawalOtpSession.deleteOne({ _id: session._id });
	return { success: true };
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
 * Body: { amount (naira), reference, otp }
 */
const requestPayout = async (req, res) => {
	logger.info("[requestPayout] START", {
		userId: req.user?.id,
		amount: req.body?.amount,
		hasOtp: Boolean(req.body?.otp),
		hasReference: Boolean(req.body?.reference),
	});
	try {
		const { id: userId, role: userType } = req.user;
		const { amount, bankDetails: submittedBankDetails, otp, reference } = req.body;
		const withdrawalAmount = Number(amount);

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can request payouts" });
		}
		if (!withdrawalAmount || withdrawalAmount <= 0) {
			return res.status(400).json({ error: "Amount must be greater than 0" });
		}
		const profile = await resolveProfile(userId, userType);
		if (!profile) {
			return res.status(404).json({ error: `${userType} profile not found` });
		}

		const bankDetails = profile.bankDetails || {};
		if (!hasCompleteBankDetails(bankDetails)) {
			return res
				.status(400)
				.json({ error: "Save bank details before requesting a withdrawal" });
		}

		if (!bankDetailsMatchSaved(submittedBankDetails, bankDetails)) {
			return res.status(400).json({
				error:
					"Withdrawals can only be sent to your saved bank account. Update your bank details first.",
			});
		}

		const otpResult = await verifyWithdrawalOtp({
			userId,
			userType: userType.toUpperCase(),
			otp,
			reference,
		});
		if (!otpResult.success) {
			return res.status(otpResult.status).json({ error: otpResult.error });
		}

		// amount comes in as naira from frontend — pass directly, no conversion
		const result = await payoutService.requestWithdrawal({
			userId,
			userType: userType.toUpperCase(),
			amount: withdrawalAmount, // naira
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
				grossAmount: withdrawalAmount,
				paystackFee: result.fees.paystackFee,
				stampDuty: result.fees.stampDuty,
				totalFee: result.fees.total,
				totalDeducted: withdrawalAmount + result.fees.total,
				netAmountSent: withdrawalAmount,
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
 * POST /api/payouts/withdrawal-otp
 * Sends an OTP to the authenticated rider/vendor phone before withdrawal.
 */
const requestWithdrawalOtp = async (req, res) => {
	try {
		const { id: userId, role: userType } = req.user;
		const { amount } = req.body;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can request withdrawal OTPs" });
		}

		if (amount != null && Number(amount) <= 0) {
			return res.status(400).json({ error: "Amount must be greater than 0" });
		}

		const [user, profile] = await Promise.all([
			User.findById(userId).select("phone"),
			resolveProfile(userId, userType),
		]);

		if (!profile) {
			return res.status(404).json({ error: `${userType} profile not found` });
		}
		if (!hasCompleteBankDetails(profile.bankDetails)) {
			return res
				.status(400)
				.json({ error: "Save bank details before requesting a withdrawal" });
		}
		if (!user?.phone) {
			return res
				.status(400)
				.json({ error: "No phone number is linked to this account" });
		}

		let fees = null;
		if (amount != null) {
			const withdrawalAmount = Number(amount);
			fees = payoutService.calculateFees(withdrawalAmount);
			const totalDebit = withdrawalAmount + fees.total;
			const balance = await ledgerService.getAccountBalance(
				profile._id,
				userType.toUpperCase(),
			);

			if (balance.availableBalance < totalDebit) {
				return res.status(400).json({
					error: `Insufficient balance. You need NGN ${totalDebit} (NGN ${withdrawalAmount} + NGN ${fees.total} fees). Available: NGN ${balance.availableBalance}`,
					availableBalance: balance.availableBalance,
					fees,
				});
			}
		}

		const phone = normalizePhone(String(user.phone));
		const reviewMode = process.env.REVIEW_MODE === "true";
		const isReviewAccount = reviewMode && phone === "8022000001";

		let reference = "test-withdrawal-reference";
		if (!isReviewAccount) {
			const sms = await requestSmsOtp(phone);
			if (!sms.success) {
				return res.status(500).json({
					error: sms.error || "Failed to send withdrawal OTP",
				});
			}
			reference = sms.reference || uuidv4();
		}

		await WithdrawalOtpSession.deleteMany({
			user: userId,
			userType: userType.toUpperCase(),
		});
		await WithdrawalOtpSession.create({
			user: userId,
			userType: userType.toUpperCase(),
			phone,
			reference,
		});

		return res.json({
			success: true,
			message: "Withdrawal OTP sent to phone",
			reference,
			phone: maskPhone(phone),
			...(fees && { fees }),
		});
	} catch (err) {
		logger.error("[requestWithdrawalOtp]", {
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
			totalDeducted: amount + fees.total,
			netAmountSent: amount,
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
	requestWithdrawalOtp,
	requestPayout,
	getFeeEstimate,
	getPendingPayouts,
	cancelPayout,
	processPayout,
	retryPayout,
	getStatement,
	getPayoutHistory,
};
