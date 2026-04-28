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

	// Resolve profile first — ledger and Payout are keyed on profile._id, not User._id
	const model = userType === "VENDOR" ? VendorProfile : RiderProfile;
	const userField = userType === "VENDOR" ? "owner" : "user";
	const profile = await model.findOne({ [userField]: userId });
	if (!profile) {
		return {
			success: false,
			reason: "profile_not_found",
			detail: `${userType} profile not found for userId ${userId}`,
		};
	}

	const recipientId = profile._id;
	const recipientType = userType === "VENDOR" ? "VendorProfile" : "RiderProfile";

	if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
		const pending = await Payout.create({
			recipientId,
			recipientType,
			amount,
			feeDeducted: fees.total,
			netAmount,
			bankDetails: bankDetails || {},
			status: "pending",
		});
		return { success: false, reason: "no_bank", payout: pending };
	}

	// Deduplication — prevent concurrent duplicate payouts
	const existingPayout = await Payout.findOne({
		recipientId,
		recipientType,
		status: { $in: ["processing", "processed"] },
	});
	if (existingPayout) {
		return {
			success: false,
			reason: "duplicate_payout",
			payout: existingPayout,
		};
	}

	// Reserve balance using profile._id (moves from available → pending in ledger)
	let reserved;
	try {
		reserved = await ledgerService.reserveBalance(recipientId, userType, amount);
	} catch {
		const failed = await Payout.create({
			recipientId,
			recipientType,
			amount,
			bankDetails,
			status: "failed",
			failureReason: "insufficient_funds",
		});
		return { success: false, reason: "insufficient_funds", payout: failed };
	}

	const stableKey = `payout_${recipientId}_${orderId ?? reserved.entry._id}`;

	let payout = await Payout.create({
		recipientId,
		recipientType,
		amount,
		feeDeducted: fees.total,
		netAmount,
		bankDetails,
		status: "processing",
		ledgerEntry: reserved.entry._id,
		idempotencyKey: stableKey,
	});

	try {
		let recipientCode;
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

		// webhook on transfer.success calls completePayout; transfer.failed/reversed calls reverseReserve
		const transfer = await paystack.transfer.initiate({
			amount: Math.round(netAmount * 100),
			recipient: recipientCode,
			reason: `Wallet Withdrawal`,
			reference: stableKey,
		});

		const transferCode = transfer?.data?.transfer_code;

		payout.status = "processing";
		payout.transactionRef = transferCode;
		await payout.save();

		return { success: true, payout };
	} catch (err) {
		logger.error("Transfer failed:", err.message);
		await ledgerService.reverseReserve(
			recipientId,
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

const processPendingPayout = async (payoutId) => {
	const payout = await Payout.findById(payoutId);

	if (!payout) {
		throw new Error(`processPendingPayout: payout ${payoutId} not found`);
	}

	if (payout.status !== "pending") {
		logger.warn(
			`processPendingPayout: payout ${payoutId} has status '${payout.status}', skipping`,
		);
		return { success: false, reason: "not_pending", payout };
	}

	const { recipientId, recipientType, amount, bankDetails } = payout;

	if (!bankDetails?.accountNumber || !bankDetails?.bankCode) {
		logger.warn(`processPendingPayout: payout ${payoutId} has no bank details`);
		return { success: false, reason: "no_bank", payout };
	}

	const fees = calculateTotalFees(amount);
	const netAmount = amount - fees.total;

	if (netAmount <= 0) {
		payout.status = "failed";
		payout.failureReason = `Amount NGN ${amount} cannot cover fees of NGN ${fees.total}`;
		await payout.save();
		return { success: false, reason: "amount_too_low", payout };
	}

	try {
		const model = recipientType === "VendorProfile" ? VendorProfile : RiderProfile;
		const profile = await model.findById(recipientId);
		if (!profile) throw new Error(`${recipientType} not found for id ${recipientId}`);

		let recipientCode;
		if (profile.paystackRecipientCode) {
			recipientCode = profile.paystackRecipientCode;
		} else {
			const recipient = await paystack.recipients.create({
				name: profile.name || "Recipient",
				account_number: bankDetails.accountNumber,
				bank_code: bankDetails.bankCode,
			});
			recipientCode = recipient?.data?.recipient_code;
			if (!recipientCode) throw new Error("Failed to get recipient code");
			profile.paystackRecipientCode = recipientCode;
			await profile.save();
		}

		const stableKey = payout.idempotencyKey ?? `payout_pending_${payoutId}`;
		if (!payout.idempotencyKey) {
			payout.idempotencyKey = stableKey;
			await payout.save();
		}

		const transfer = await paystack.transfer.initiate({
			amount: Math.round(netAmount * 100),
			recipient: recipientCode,
			reason: "Wallet Withdrawal",
			reference: stableKey,
		});

		const transferCode = transfer?.data?.transfer_code;
		if (!transferCode) throw new Error("No transfer_code returned from Paystack");

		// Stay as "pending" — webhook sets it to "processed" on success
		payout.transactionRef = transferCode;
		payout.feeDeducted = fees.total;
		payout.netAmount = netAmount;
		await payout.save();

		logger.info(
			`[PAYOUT] Pending payout initiated: payoutId=${payoutId} transferCode=${transferCode}`,
		);
		return { success: true, payout };
	} catch (err) {
		logger.error(`processPendingPayout: transfer failed for ${payoutId}: ${err.message}`);
		payout.status = "failed";
		payout.failureReason = err.message;
		await payout.save();
		return { success: false, reason: "transfer_failed", error: err.message, payout };
	}
};

const processPendingPayoutsForUser = async (userId, userType) => {
	// Resolve profile _id — Payout stores recipientId (profile._id), not User._id
	const model = userType === "VENDOR" ? VendorProfile : RiderProfile;
	const userField = userType === "VENDOR" ? "owner" : "user";
	const profile = await model.findOne({ [userField]: userId });

	if (!profile) {
		logger.warn(`processPendingPayoutsForUser: no ${userType} profile for userId=${userId}`);
		return { processed: 0, results: [] };
	}

	const recipientType = userType === "VENDOR" ? "VendorProfile" : "RiderProfile";

	const pendingPayouts = await Payout.find({
		recipientId: profile._id,
		recipientType,
		status: "pending",
	}).sort({ createdAt: 1 });

	if (pendingPayouts.length === 0) {
		logger.info(
			`processPendingPayoutsForUser: no pending payouts for ${userType} ${userId}`,
		);
		return { processed: 0, results: [] };
	}

	logger.info(
		`processPendingPayoutsForUser: processing ${pendingPayouts.length} payout(s) for ${userType} ${userId}`,
	);

	const results = [];
	for (const payout of pendingPayouts) {
		const result = await processPendingPayout(payout._id);
		results.push({ payoutId: payout._id, ...result });

		if (result.reason === "insufficient_funds") {
			logger.warn(
				`processPendingPayoutsForUser: stopping — insufficient funds at payoutId=${payout._id}`,
			);
			break;
		}
	}

	const succeeded = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	logger.info(
		`processPendingPayoutsForUser: done — ${succeeded} succeeded, ${failed} failed for ${userType} ${userId}`,
	);

	return { processed: results.length, succeeded, failed, results };
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
	if (payout.status === "processed") {
		logger.warn(
			`handleTransferSuccess: already processed for transferCode=${transferCode}`,
		);
		return;
	}

	const successLedgerType =
		payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";
	await ledgerService.completePayout(
		payout.recipientId,
		successLedgerType,
		payout.amount,
	);
	payout.status = "processed";
	payout.processedAt = new Date();
	await payout.save();

	logger.info(
		`[PAYOUT] Completed: transferCode=${transferCode} recipientId=${payout.recipientId} amount=${payout.amount}`,
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

	const failureLedgerType =
		payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";
	await ledgerService.reverseReserve(
		payout.recipientId,
		failureLedgerType,
		payout.amount,
		reason,
	);
	payout.status = "failed";
	payout.failureReason = reason;
	await payout.save();

	logger.info(
		`[PAYOUT] Reversed: transferCode=${transferCode} recipientId=${payout.recipientId} amount=${payout.amount}`,
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
