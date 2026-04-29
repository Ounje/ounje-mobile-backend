const ledgerService = require("../services/ledger.service");
const { Payout } = require("../models");
const payoutService = require("../services/payout.service");
const RiderProfile = require("../models/RiderProfile");
const VendorProfile = require("../models/VendorProfile");
const logger = require("../utils/logger");

/**
 * Get current balance for rider/vendor
 * GET /api/payouts/balance
 */
const getBalance = async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.role;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view balances" });
		}

		let accountUserId = userId;
		if (userType === "vendor") {
			const vp = await VendorProfile.findOne({ owner: userId }).select("_id");
			if (!vp)
				return res.status(404).json({ error: "Vendor profile not found" });
			accountUserId = vp._id;
		} else if (userType === "rider") {
			const rp = await RiderProfile.findOne({ user: userId }).select("_id");
			if (!rp)
				return res.status(404).json({ error: "Rider profile not found" });
			accountUserId = rp._id;
		}

		const balance = await ledgerService.getAccountBalance(
			accountUserId,
			userType.toUpperCase(),
		);

		const totalEarnings =
			(balance.availableBalance ?? 0) +
			(balance.holdBalance ?? 0) +
			(balance.pendingBalance ?? 0);

		res.json({ ...balance, totalEarnings });
	} catch (error) {
		console.error("Balance fetch error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get transaction history
 * GET /api/payouts/history?limit=20&skip=0
 */
const getTransactionHistory = async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.role;
		const { limit = 20, skip = 0 } = req.query;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view history" });
		}

		let accountUserId = userId;
		if (userType === "vendor") {
			const vp = await VendorProfile.findOne({ owner: userId }).select("_id");
			if (!vp)
				return res.status(404).json({ error: "Vendor profile not found" });
			accountUserId = vp._id;
		} else if (userType === "rider") {
			const rp = await RiderProfile.findOne({ user: userId }).select("_id");
			if (!rp)
				return res.status(404).json({ error: "Rider profile not found" });
			accountUserId = rp._id;
		}

		const history = await ledgerService.getTransactionHistory(
			accountUserId,
			userType.toUpperCase(),
			parseInt(limit),
			parseInt(skip),
		);

		res.json(history);
	} catch (error) {
		console.error("History fetch error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Request a payout (reserve balance)
 * POST /api/payouts/request
 * Body: { amount, bankDetails: { accountNumber, bankCode, accountName } }
 */
const requestPayout = async (req, res) => {
	logger.info("🔴 STEP 1 HIT", { body: req.body });
	try {
		const userId = req.user.id;
		const userType = req.user.role;
		const { amount, bankDetails, withdrawalType = "next_day" } = req.body;

		logger.info("🔴 STEP 2 — parsed", { userId, userType, amount });

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can request payouts" });
		}
		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Amount must be greater than 0" });
		}
		if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
			return res.status(400).json({ error: "Bank details required" });
		}

		logger.info("🔴 STEP 3 — about to find profile");

		const INSTANT_FEE = 100;
		const instantFee = withdrawalType === "instant" ? INSTANT_FEE : 0;
		const totalDebit = amount + instantFee;

		let accountUserId;
		if (userType === "vendor") {
			const vp = await VendorProfile.findOne({ owner: userId });
			logger.info("🔴 STEP 4 — vendor profile result", {
				profileId: vp?._id ?? "NOT FOUND",
			});
			if (!vp)
				return res.status(404).json({ error: "Vendor profile not found" });
			accountUserId = vp._id;
		} else {
			const rp = await RiderProfile.findOne({ user: userId });
			logger.info("🔴 STEP 4 — rider profile result", {
				profileId: rp?._id ?? "NOT FOUND",
			});
			if (!rp)
				return res.status(404).json({ error: "Rider profile not found" });
			accountUserId = rp._id;
		}

		// Balance check — must cover withdrawal amount plus instant fee
		const balance = await ledgerService.getAccountBalance(
			accountUserId,
			userType.toUpperCase(),
		);

		if (balance.availableBalance < totalDebit) {
			return res.status(400).json({
				error:
					instantFee > 0
						? `Insufficient balance. You need ₦${totalDebit} (₦${amount} + ₦${instantFee} instant fee). Available: ₦${balance.availableBalance}`
						: `Insufficient balance. Available: ₦${balance.availableBalance}`,
				availableBalance: balance.availableBalance,
			});
		}

		// ── INSTANT: fire transfer immediately ───────────────────────────────
		if (withdrawalType === "instant") {
			// Debit the ₦100 instant fee as platform revenue first
			await ledgerService.debitAccount(
				accountUserId,
				userType.toUpperCase(),
				instantFee,
				"INSTANT_WITHDRAWAL_FEE",
			);

			const result = await payoutService.processSinglePayout({
				userId,
				userType: userType.toUpperCase(),
				amount,
				bankDetails,
				name: bankDetails.accountName || "",
			});

			if (!result.success) {
				// Refund the instant fee — transfer never left
				await ledgerService.creditAccount(
					accountUserId,
					userType.toUpperCase(),
					instantFee,
					"REFUND",
					null,
					{ note: "instant fee refund — transfer failed to initiate" },
				);
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
				});
			}

			// Tag the payout record with withdrawalType and the instant fee
			result.payout.withdrawalType = "instant";
			result.payout.feeDeducted = (result.payout.feeDeducted || 0) + instantFee;
			await result.payout.save();

			logger.info(`[Payout] instant initiated | payoutId=${result.payout._id} userId=${userId} amount=${amount}`);

			return res.status(201).json({
				message: "Instant payout initiated — transfer is being processed",
				payout: {
					payoutId: result.payout._id,
					amount: result.payout.amount,
					feeDeducted: result.payout.feeDeducted,
					netAmount: result.payout.netAmount,
					withdrawalType: "instant",
					status: result.payout.status,
					transactionRef: result.payout.transactionRef,
					requestedAt: result.payout.createdAt,
				},
			});
		}

		// ── NEXT_DAY: queue for batch processing ─────────────────────────────
		const reserved = await ledgerService.reserveBalance(
			accountUserId,
			userType.toUpperCase(),
			amount,
		);

		const payout = await Payout.create({
			recipientId,
			recipientType,
			amount,
			withdrawalType: "next_day",
			feeDeducted: 0,
			bankDetails: {
				bankName: bankDetails.bankName || "",
				accountNumber: bankDetails.accountNumber,
				accountName: bankDetails.accountName || "",
				bankCode: bankDetails.bankCode,
			},
			status: "pending",
		});

		logger.info(`[Payout] next_day queued | payoutId=${payout._id} userId=${userId} amount=${amount}`);

		return res.status(201).json({
			message: "Payout request submitted — will be processed next business day",
			payout: {
				payoutId: payout._id,
				amount: payout.amount,
				feeDeducted: payout.feeDeducted,
				withdrawalType: payout.withdrawalType,
				status: payout.status,
				requestedAt: payout.createdAt,
			},
			updatedBalance: {
				availableBalance: reserved.availableBalance,
				pendingBalance: reserved.pendingBalance,
			},
		});
	} catch (error) {
		logger.error("Payout request error:", error.message);
		res.status(500).json({ error: error.message });
	}
};
/**
 * Get pending payout requests
 * GET /api/payouts/pending
 */
const getPendingPayouts = async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.role;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view payouts" });
		}

		// ✅ Resolve profile _id for correct query
		let recipientId;
		if (userType === "vendor") {
			const vp = await VendorProfile.findOne({ owner: userId }).select("_id");
			if (!vp)
				return res.status(404).json({ error: "Vendor profile not found" });
			recipientId = vp._id;
		} else {
			const rp = await RiderProfile.findOne({ user: userId }).select("_id");
			if (!rp)
				return res.status(404).json({ error: "Rider profile not found" });
			recipientId = rp._id;
		}

		const payouts = await Payout.find({
			recipientId,
			status: { $in: ["pending", "processing"] },
		}).sort({ createdAt: -1 });

		res.json(payouts);
	} catch (error) {
		console.error("Pending payouts fetch error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Cancel a payout request (admin or user)
 * PUT /api/payouts/:payoutId/cancel
 */
const cancelPayout = async (req, res) => {
	try {
		const { payoutId } = req.params;
		const userId = req.user.id;
		const userType = req.user.role;

		const payout = await Payout.findById(payoutId);
		if (!payout) {
			return res.status(404).json({ error: "Payout not found" });
		}

		// ✅ Resolve profile _id to verify ownership
		let accountUserId;
		if (userType === "vendor") {
			const vp = await VendorProfile.findOne({ owner: userId }).select("_id");
			if (!vp)
				return res.status(404).json({ error: "Vendor profile not found" });
			accountUserId = vp._id;
		} else if (userType === "rider") {
			const rp = await RiderProfile.findOne({ user: userId }).select("_id");
			if (!rp)
				return res.status(404).json({ error: "Rider profile not found" });
			accountUserId = rp._id;
		}

		// ✅ Authorization check uses recipientId (profile _id), not user._id
		if (
			userType !== "admin" &&
			payout.recipientId.toString() !== accountUserId.toString()
		) {
			return res.status(403).json({ error: "Unauthorized" });
		}

		if (payout.status !== "pending") {
			return res.status(400).json({
				error: `Cannot cancel payout with status: ${payout.status}`,
			});
		}

		// ✅ Reverse reservation using recipientId and recipientType from payout doc
		const reversed = await ledgerService.reverseReserve(
			payout.recipientId,
			payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER",
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
		console.error("Cancel payout error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Process payout (admin endpoint)
 * PUT /api/payouts/:payoutId/process
 */
const processPayout = async (req, res) => {
	try {
		const { payoutId } = req.params;
		const { transactionRef, status = "completed" } = req.body;

		if (req.user.role !== "admin") {
			return res.status(403).json({ error: "Only admins can process payouts" });
		}

		const payout = await Payout.findById(payoutId);
		if (!payout) {
			return res.status(404).json({ error: "Payout not found" });
		}

		if (payout.status !== "pending" && payout.status !== "processing") {
			return res.status(400).json({
				error: `Cannot process payout with status: ${payout.status}`,
			});
		}

		// ✅ Derive userType from recipientType stored on payout
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

		// ✅ Complete payout uses recipientId (profile _id)
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
		console.error("Process payout error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Admin: Retry a pending/failed payout by id
 * POST /api/payouts/:payoutId/retry
 */
const retryPayout = async (req, res) => {
	try {
		if (req.user.role !== "admin")
			return res.status(403).json({ error: "Only admins can retry payouts" });
		const { payoutId } = req.params;
		const result = await payoutService.processPendingPayout(payoutId);
		if (result && result.success)
			return res.json({ message: "Payout retried successfully", result });
		return res.status(400).json({ message: "Payout retry failed", result });
	} catch (error) {
		console.error("Retry payout error:", error.message);
		res.status(500).json({ error: error.message });
	}
};

/**
 * GET /api/payouts/history
 * Fetch withdrawal history for the logged-in Vendor or Rider
 */
const getPayoutHistory = async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.role;
		const { page = 1, limit = 10 } = req.query;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view payout history" });
		}

		// ✅ Resolve profile _id
		let recipientId, recipientType;
		if (userType === "vendor") {
			const vp = await VendorProfile.findOne({ owner: userId }).select("_id");
			if (!vp)
				return res.status(404).json({ error: "Vendor profile not found" });
			recipientId = vp._id;
			recipientType = "VendorProfile";
		} else {
			const rp = await RiderProfile.findOne({ user: userId }).select("_id");
			if (!rp)
				return res.status(404).json({ error: "Rider profile not found" });
			recipientId = rp._id;
			recipientType = "RiderProfile";
		}

		const query = { recipientId, recipientType };

		const history = await Payout.find(query)
			.sort({ createdAt: -1 })
			.limit(limit * 1)
			.skip((page - 1) * limit)
			.exec();

		const count = await Payout.countDocuments(query);

		res.json({
			success: true,
			data: history,
			pagination: {
				total: count,
				pages: Math.ceil(count / limit),
				currentPage: page,
			},
		});
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

/**
 * Get account statement (for reconciliation)
 * GET /api/payouts/statement?startDate=2025-01-01&endDate=2025-12-31
 */
const getStatement = async (req, res) => {
	try {
		const userId = req.user.id;
		const userType = req.user.role;
		const { startDate, endDate } = req.query;

		if (!["rider", "vendor"].includes(userType)) {
			return res
				.status(403)
				.json({ error: "Only riders and vendors can view statements" });
		}

		if (!startDate || !endDate) {
			return res
				.status(400)
				.json({ error: "startDate and endDate required (YYYY-MM-DD format)" });
		}

		// ✅ Resolve profile _id
		let accountUserId;
		if (userType === "vendor") {
			const vp = await VendorProfile.findOne({ owner: userId }).select("_id");
			if (!vp)
				return res.status(404).json({ error: "Vendor profile not found" });
			accountUserId = vp._id;
		} else {
			const rp = await RiderProfile.findOne({ user: userId }).select("_id");
			if (!rp)
				return res.status(404).json({ error: "Rider profile not found" });
			accountUserId = rp._id;
		}

		const statement = await ledgerService.getAccountStatement(
			accountUserId,
			userType.toUpperCase(),
			new Date(startDate),
			new Date(endDate),
		);

		res.json(statement);
	} catch (error) {
		console.error("Statement fetch error:", error.message);
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
