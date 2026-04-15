const mongoose = require("mongoose");
const Payout = require("../models/Payout");

const VendorProfile = require("../models/VendorProfile");
const RiderProfile = require("../models/RiderProfile");

const paystack = require("../utils/paystack");
const ledgerService = require("./ledger.service");

const logger = require("../utils/logger"); // FIX #6: use logger

// Ensure critical models are registered
if (!mongoose.models.VendorProfile) {
	try {
		require("../models/VendorProfile");
	} catch (e) {
		logger.warn("VendorProfile model load error:", e.message);
	}
}
if (!mongoose.models.RiderProfile) {
	try {
		require("../models/RiderProfile");
	} catch (e) {
		logger.warn("RiderProfile model load error:", e.message);
	}
}

/**
 * HELPER: Calculates total deductions (Paystack Fee + 2026 Stamp Duty)
 * Based on Paystack Nigeria Transfer Rates and 2026 Tax Laws.
 */
const calculateTotalFees = (amount) => {
	let paystackFee = 0;
	let stampDuty = 0;

	// 1. Paystack Transfer Fee Bands
	if (amount <= 5000) {
		paystackFee = 10;
	} else if (amount <= 50000) {
		paystackFee = 25;
	} else {
		paystackFee = 50;
	}

	// 2. 2026 Electronic Money Transfer Levy (Stamp Duty)
	if (amount >= 10000) {
		stampDuty = 50;
	}

	return {
		paystackFee,
		stampDuty,
		total: paystackFee + stampDuty,
	};
};

/**
 * Process a single payout to a user's BANK account via Paystack
 */
const processSinglePayout = async ({
	userId,
	userType,
	amount,
	bankDetails,
	name,
	orderId,
}) => {
	logger.info(
		`Processing withdrawal for ${userType} ${userId} amount: ${amount}`,
	);

	const fees = calculateTotalFees(amount);
	const netAmount = amount - fees.total;

	if (netAmount <= 0) {
		return {
			success: false,
			reason: "amount_too_low",
			detail: `Amount NGN ${amount} cannot cover fees of NGN ${fees.total}`,
		};
	}

	if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
		const pending = await Payout.create({
			user: userId,
			userType,
			order: orderId,
			amount,
			feeDeducted: fees.total,
			netAmount,
			bankDetails: bankDetails || {},
			status: "pending",
		});
		return { success: false, reason: "no_bank", payout: pending };
	}

	// FIX #3: Deduplication — prevent concurrent duplicate payouts
	const existingPayout = await Payout.findOne({
		user: userId,
		...(orderId ? { order: orderId } : {}),
		status: { $in: ["processing", "completed"] },
	});
	if (existingPayout) {
		return {
			success: false,
			reason: "duplicate_payout",
			payout: existingPayout,
		};
	}

	// Reserve balance (moves from available → pending in ledger)
	let reserved;
	try {
		reserved = await ledgerService.reserveBalance(userId, userType, amount);
	} catch (err) {
		const failed = await Payout.create({
			user: userId,
			userType,
			order: orderId,
			amount,
			bankDetails,
			status: "failed",
			failureReason: "insufficient_funds",
		});
		return { success: false, reason: "insufficient_funds", payout: failed };
	}

	// FIX #2: stable idempotency key — not timestamp-based
	const stableKey = `payout_${userId}_${orderId ?? reserved.entry._id}`;

	let payout = await Payout.create({
		user: userId,
		userType,
		order: orderId,
		amount,
		feeDeducted: fees.total,
		netAmount,
		bankDetails,
		status: "processing",
		ledgerEntry: reserved.entry._id,
		idempotencyKey: stableKey,
	});

	try {
		// Resolve Paystack Recipient
		let recipientCode;
		const model = userType === "VENDOR" ? VendorProfile : RiderProfile;

		// FIX #5: use findOne({ user: userId }) not findById(userId)
		const profile = await model.findOne({ user: userId });
		if (!profile)
			throw new Error(`${userType} profile not found for userId ${userId}`);

		if (profile.paystackRecipientCode) {
			recipientCode = profile.paystackRecipientCode;
		} else {
			const recipient = await paystack.recipients.create({
				name: name || profile.name || "Recipient",
				account_number: bankDetails.accountNumber,
				bank_code: bankDetails.bankCode,
			});
			recipientCode = recipient?.data?.recipient_code;
			if (!recipientCode) throw new Error("Failed to get recipient code");
			profile.paystackRecipientCode = recipientCode;
			await profile.save();
		}

		// Trigger Transfer
		const transfer = await paystack.transfer.initiate({
			// FIX #4: send netAmount (after fees) not full amount
			amount: Math.round(netAmount * 100),
			recipient: recipientCode,
			reason: `Wallet Withdrawal`,
			reference: stableKey, // FIX #2: pass stable key as Paystack reference
		});

		const transferCode = transfer?.data?.transfer_code;

		// FIX #1: Do NOT call completePayout here.
		// completePayout is called in the Paystack webhook on transfer.success.
		// reverseReserve is called on transfer.failed / transfer.reversed.
		// This prevents ledger debit before money actually leaves Paystack.

		payout.status = "processing"; // stays processing until webhook confirms
		payout.transactionRef = transferCode;
		await payout.save();

		return { success: true, payout };
	} catch (err) {
		logger.error("Transfer failed:", err.message);
		await ledgerService.reverseReserve(
			userId,
			userType,
			amount,
			`Withdrawal failed: ${err.message}`,
		);
		payout.status = "failed";
		payout.failureReason = err.message;
		await payout.save();
		return {
			success: false,
			reason: "transfer_failed",
			error: err.message,
			payout,
		};
	}
};

const processAutoPayoutsForOrder = async (orderId) => {
	logger.info(
		`Skipping auto-bank transfer for order ${orderId}. Funds are managed in internal wallets.`,
	);
	return { vendor: "MANAGED_IN_WALLET", rider: "MANAGED_IN_WALLET" };
};

// FIX #7: stubs throw instead of silently doing nothing
const processPendingPayout = async (payoutId) => {
	throw new Error("processPendingPayout: not yet implemented");
};

const processPendingPayoutsForUser = async (userId, userType) => {
	throw new Error("processPendingPayoutsForUser: not yet implemented");
};

/**
 * Fetch user bank details (used by rider/vendor profile)
 */
const getUserBankDetails = async (userId, userType = "RIDER") => {
	const Model = userType === "VENDOR" ? VendorProfile : RiderProfile;

	// FIX #5: consistent use of findOne({ user: userId })
	const profile = await Model.findOne({ user: userId }).select(
		"bankDetails paystackRecipientCode",
	);

	if (!profile || !profile.bankDetails) {
		return null;
	}

	return {
		accountNumber: profile.bankDetails.accountNumber,
		bankCode: profile.bankDetails.bankCode,
		bankName: profile.bankDetails.bankName,
		accountName: profile.bankDetails.accountName,
		paystackRecipientCode: profile.paystackRecipientCode || null,
	};
};

/**
 * NEW: Called by Paystack webhook on transfer.success
 * Finalizes the ledger — debits pendingBalance (money has left the system).
 */
const handleTransferSuccess = async (transferCode) => {
	const payout = await Payout.findOne({ transactionRef: transferCode });
	if (!payout) {
		logger.warn(
			`handleTransferSuccess: no payout found for transferCode=${transferCode}`,
		);
		return;
	}
	if (payout.status === "completed") {
		logger.warn(
			`handleTransferSuccess: already completed for transferCode=${transferCode}`,
		);
		return;
	}

	await ledgerService.completePayout(
		payout.user,
		payout.userType,
		payout.amount,
	);
	payout.status = "completed";
	payout.processedAt = new Date();
	await payout.save();

	logger.info(
		`[PAYOUT] Completed: transferCode=${transferCode} userId=${payout.user} amount=${payout.amount}`,
	);
};

/**
 * NEW: Called by Paystack webhook on transfer.failed / transfer.reversed
 * Moves money back from pending → available in the ledger.
 */
const handleTransferFailure = async (
	transferCode,
	reason = "Transfer failed",
) => {
	const payout = await Payout.findOne({ transactionRef: transferCode });
	if (!payout) {
		logger.warn(
			`handleTransferFailure: no payout found for transferCode=${transferCode}`,
		);
		return;
	}
	if (payout.status === "failed") {
		logger.warn(
			`handleTransferFailure: already failed for transferCode=${transferCode}`,
		);
		return;
	}

	await ledgerService.reverseReserve(
		payout.user,
		payout.userType,
		payout.amount,
		reason,
	);
	payout.status = "failed";
	payout.failureReason = reason;
	await payout.save();

	logger.info(
		`[PAYOUT] Reversed: transferCode=${transferCode} userId=${payout.user} amount=${payout.amount}`,
	);
};

module.exports = {
	processAutoPayoutsForOrder,
	processSinglePayout,
	processPendingPayout,
	processPendingPayoutsForUser,
	getUserBankDetails,
	handleTransferSuccess, // wire these up in your webhook handler
	handleTransferFailure,
};
