const mongoose = require("mongoose");

const Payout = require("../models/Payout");
const VendorProfile = require("../models/VendorProfile");
const RiderProfile = require("../models/RiderProfile");

const paystack = require("../utils/paystack");
const ledgerService = require("./ledger.service");

// ADDED: centralized logger (replace console.log / console.error)
const logger = require("../utils/logger");

// Ensure models are registered
if (!mongoose.models.VendorProfile) {
	try {
		require("../models/VendorProfile");
	} catch (e) {
		logger.warn("VendorProfile load error:", e.message); // changed from console.warn
	}
}

if (!mongoose.models.RiderProfile) {
	try {
		require("../models/RiderProfile");
	} catch (e) {
		logger.warn("RiderProfile load error:", e.message); // changed from console.warn
	}
}

/**
 * Calculate Paystack + Stamp Duty (2026 Nigeria)
 */
const calculateTotalFees = (amount) => {
	let paystackFee = 0;
	let stampDuty = 0;

	if (amount <= 5000) paystackFee = 10;
	else if (amount <= 50000) paystackFee = 25;
	else paystackFee = 50;

	if (amount >= 10000) stampDuty = 50;

	return {
		paystackFee,
		stampDuty,
		total: paystackFee + stampDuty,
	};
};

/**
 * MAIN: Process payout
 */
const processSinglePayout = async ({
	userId,
	userType,
	amount,
	bankDetails,
	name,
	orderId,
}) => {
	// CHANGED: console.log → logger.info
	logger.info(`[PAYOUT] ${userType} ${userId} -> ₦${amount}`);

	// ─────────────────────────────────────────────
	// 1. Calculate fees
	// ─────────────────────────────────────────────
	const fees = calculateTotalFees(amount);

	// ADDED: net amount after deductions
	const netAmount = amount - fees.total;

	// ADDED: guard against invalid payout after fees
	if (netAmount <= 0) {
		return {
			success: false,
			reason: "amount_too_low",
			detail: `Amount ₦${amount} cannot cover fees ₦${fees.total}`,
		};
	}

	// ─────────────────────────────────────────────
	// 2. Validate bank details
	// ─────────────────────────────────────────────
	if (!bankDetails?.accountNumber || !bankDetails?.bankCode) {
		// ADDED: store payout as pending instead of failing hard
		const pending = await Payout.create({
			user: userId,
			userType,
			order: orderId,
			amount,
			feeDeducted: fees.total, // ADDED: persist deducted fees
			netAmount, // ADDED: persist net payout
			bankDetails: bankDetails || {},
			status: "pending",
		});

		return { success: false, reason: "no_bank", payout: pending };
	}

	// ─────────────────────────────────────────────
	// 3. Reserve funds (Ledger)
	// ─────────────────────────────────────────────
	let reserved;
	try {
		reserved = await ledgerService.reserveBalance(userId, userType, amount);
	} catch (err) {
		// ADDED: create failed payout record for insufficient funds
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

	// ─────────────────────────────────────────────
	// 4. Create payout record
	// ─────────────────────────────────────────────
	// ADDED: idempotency key for safe retries
	const idempotencyKey = `payout_${Date.now()}_${userId}`;

	let payout = await Payout.create({
		user: userId,
		userType,
		order: orderId,
		amount,
		feeDeducted: fees.total, // ADDED
		netAmount, // ADDED
		bankDetails,
		status: "processing",
		ledgerEntry: reserved.entry._id,
		idempotencyKey,
	});

	try {
		// ─────────────────────────────────────────────
		// 5. Get or create Paystack recipient
		// ─────────────────────────────────────────────
		const Model = userType === "VENDOR" ? VendorProfile : RiderProfile;
		const user = await Model.findById(userId);

		// ADDED: safety check to prevent null access crash
		if (!user) throw new Error("User profile not found");

		let recipientCode = user.paystackRecipientCode;

		if (!recipientCode) {
			const recipient = await paystack.recipients.create({
				name: name || user.name || "Recipient",
				account_number: bankDetails.accountNumber,
				bank_code: bankDetails.bankCode,
			});

			recipientCode = recipient?.data?.recipient_code;

			// ADDED: explicit validation of Paystack response
			if (!recipientCode) {
				throw new Error("Failed to create recipient");
			}

			user.paystackRecipientCode = recipientCode;
			await user.save();
		}

		// ─────────────────────────────────────────────
		// 6. Initiate transfer
		// ─────────────────────────────────────────────
		const transfer = await paystack.transfer.initiate({
			// FIX: send NET amount (after fees), not full amount
			amount: Math.round(netAmount * 100),
			recipient: recipientCode,
			reason: "Wallet Withdrawal",
			idempotencyKey,
		});

		const transferCode = transfer?.data?.transfer_code;

		// ─────────────────────────────────────────────
		// 7. Finalize ledger
		// ─────────────────────────────────────────────
		await ledgerService.completePayout(userId, userType, amount);

		// ─────────────────────────────────────────────
		// 8. Mark success
		// ─────────────────────────────────────────────
		payout.status = "completed";
		payout.transactionRef = transferCode;
		payout.processedAt = new Date();

		await payout.save();

		return { success: true, payout };
	} catch (err) {
		// CHANGED: console.error → logger.error
		logger.error("[PAYOUT ERROR]", err.message);

		// ─────────────────────────────────────────────
		// Rollback ledger
		// ─────────────────────────────────────────────
		await ledgerService.reverseReserve(userId, userType, amount, err.message);

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

/**
 * Disable auto payout (wallet-managed system)
 */
const processAutoPayoutsForOrder = async (orderId) => {
	// CHANGED: console.log → logger.info
	logger.info(`[PAYOUT] Auto-transfer disabled for order ${orderId}`);

	return {
		vendor: "MANAGED_IN_WALLET",
		rider: "MANAGED_IN_WALLET",
	};
};

/**
 * Get bank details
 */
const getUserBankDetails = async (userId, userType = "RIDER") => {
	const Model = userType === "VENDOR" ? VendorProfile : RiderProfile;

	const profile = await Model.findById(userId).select(
		"bankDetails paystackRecipientCode",
	);

	if (!profile || !profile.bankDetails) return null;

	return {
		accountNumber: profile.bankDetails.accountNumber,
		bankCode: profile.bankDetails.bankCode,
		bankName: profile.bankDetails.bankName,
		accountName: profile.bankDetails.accountName,
		paystackRecipientCode: profile.paystackRecipientCode || null,
	};
};

module.exports = {
	processSinglePayout,
	processAutoPayoutsForOrder,
	getUserBankDetails,
};
