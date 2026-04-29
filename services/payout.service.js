const mongoose = require("mongoose");
const Payout = require("../models/Payout");

const VendorProfile = require("../models/VendorProfile");
const RiderProfile = require("../models/RiderProfile");

const paystack = require("../utils/paystack");
const ledgerService = require("./ledger.service");
const logger = require("../utils/logger");

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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * HELPER: Calculates total deductions (Paystack Fee + 2026 Stamp Duty)
 * amount must be in NAIRA (not kobo).
 * Based on Paystack Nigeria Transfer Rates and 2026 Tax Laws.
 */
const calculateTotalFees = (amount) => {
	let paystackFee = 0;
	let stampDuty = 0;

	// 1. Paystack Transfer Fee Bands (naira)
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

	const total = paystackFee + stampDuty;

	logger.debug(
		`[calculateTotalFees] amount=NGN${amount} paystackFee=${paystackFee} stampDuty=${stampDuty} totalFees=${total}`,
	);

	return { paystackFee, stampDuty, total };
};

/**
 * HELPER: Resolve profile and recipientType from userId + userType.
 * FIX: vendors use `owner` field, riders use `user` field.
 */
const resolveProfile = async (userId, userType) => {
	const model = userType === "VENDOR" ? VendorProfile : RiderProfile;
	const userField = userType === "VENDOR" ? "owner" : "user";

	logger.debug(
		`[resolveProfile] userType=${userType} userField=${userField} userId=${userId}`,
	);

	const profile = await model.findOne({ [userField]: userId });

	if (!profile) {
		logger.warn(
			`[resolveProfile] No ${userType} profile found for userId=${userId}`,
		);
		return null;
	}

	logger.debug(
		`[resolveProfile] Found profile _id=${profile._id} for userId=${userId}`,
	);
	return profile;
};

/**
 * HELPER: Ensure a Paystack recipient_code exists on the profile.
 * Creates one if missing, saves it back to the profile.
 */
const ensureRecipientCode = async (profile, bankDetails, name) => {
	if (profile.paystackRecipientCode) {
		logger.debug(
			`[ensureRecipientCode] Using cached recipient_code=${profile.paystackRecipientCode} for profile=${profile._id}`,
		);
		return profile.paystackRecipientCode;
	}

	logger.info(
		`[ensureRecipientCode] No recipient_code on profile=${profile._id} — creating one via Paystack`,
	);

	const recipient = await paystack.recipients.create({
		name: name || profile.name || "Recipient",
		account_number: bankDetails.accountNumber,
		bank_code: bankDetails.bankCode,
	});

	const recipientCode = recipient?.data?.recipient_code;

	if (!recipientCode) {
		logger.error(
			`[ensureRecipientCode] Paystack returned no recipient_code for profile=${profile._id}`,
		);
		throw new Error("Paystack did not return a recipient_code");
	}

	logger.info(
		`[ensureRecipientCode] Created recipient_code=${recipientCode} for profile=${profile._id} — saving to profile`,
	);

	profile.paystackRecipientCode = recipientCode;
	await profile.save();

	return recipientCode;
};

// ─── MAIN FUNCTIONS ───────────────────────────────────────────────────────────

/**
 * Process a single payout to a user's BANK account via Paystack.
 * amount must be in NAIRA.
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
		`[processSinglePayout] START — userType=${userType} userId=${userId} amount=NGN${amount} orderId=${orderId}`,
	);

	// 1. Fee calculation
	const fees = calculateTotalFees(amount);
	const netAmount = amount - fees.total;

	logger.info(
		`[processSinglePayout] netAmount=NGN${netAmount} (gross=NGN${amount} fees=NGN${fees.total})`,
	);

	if (netAmount <= 0) {
		logger.warn(
			`[processSinglePayout] Amount NGN${amount} cannot cover fees NGN${fees.total} — aborting`,
		);
		return {
			success: false,
			reason: "amount_too_low",
			detail: `Amount NGN ${amount} cannot cover fees of NGN ${fees.total}`,
		};
	}

	// 2. Resolve profile — FIX: uses correct field per userType
	const profile = await resolveProfile(userId, userType);
	if (!profile) {
		return {
			success: false,
			reason: "profile_not_found",
			detail: `${userType} profile not found for userId ${userId}`,
		};
	}

	const recipientId = profile._id;
	const recipientType =
		userType === "VENDOR" ? "VendorProfile" : "RiderProfile";

	logger.debug(
		`[processSinglePayout] recipientId=${recipientId} recipientType=${recipientType}`,
	);

	// 3. Bank details check — if missing, queue as pending and exit
	if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
		logger.warn(
			`[processSinglePayout] bankDetails missing for ${userType} userId=${userId} — creating pending payout`,
		);
		const pending = await Payout.create({
			recipientId,
			recipientType,
			amount,
			feeDeducted: fees.total,
			netAmount,
			bankDetails: bankDetails || {},
			status: "pending",
		});
		logger.info(
			`[processSinglePayout] Pending payout created payoutId=${pending._id} — user must add bank details`,
		);
		return { success: false, reason: "no_bank", payout: pending };
	}

	logger.debug(
		`[processSinglePayout] bankDetails OK — accountNumber=${bankDetails.accountNumber} bankCode=${bankDetails.bankCode}`,
	);

	// 4. Deduplication — prevent concurrent duplicate payouts
	const existingPayout = await Payout.findOne({
		recipientId,
		recipientType,
		status: { $in: ["processing", "processed"] },
	});
	if (existingPayout) {
		logger.warn(
			`[processSinglePayout] Duplicate detected — existing payoutId=${existingPayout._id} status=${existingPayout.status}`,
		);
		return {
			success: false,
			reason: "duplicate_payout",
			payout: existingPayout,
		};
	}

	// 5. Reserve balance in ledger (available → pending)
	logger.info(
		`[processSinglePayout] Reserving NGN${amount} in ledger for recipientId=${recipientId}`,
	);
	let reserved;
	try {
		reserved = await ledgerService.reserveBalance(
			recipientId,
			userType,
			amount,
		);
		logger.info(
			`[processSinglePayout] Ledger reserve success — ledgerEntryId=${reserved.entry._id}`,
		);
	} catch (err) {
		logger.error(
			`[processSinglePayout] Ledger reserve failed for recipientId=${recipientId}: ${err.message}`,
		);
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
	logger.debug(`[processSinglePayout] idempotencyKey=${stableKey}`);

	// 6. Create payout record at "processing"
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

	logger.info(
		`[processSinglePayout] Payout record created payoutId=${payout._id}`,
	);

	try {
		// 7. Ensure Paystack recipient_code
		const recipientCode = await ensureRecipientCode(profile, bankDetails, name);

		// 8. Initiate Paystack transfer — amount in kobo
		const amountKobo = Math.round(netAmount * 100);
		logger.info(
			`[processSinglePayout] Initiating Paystack transfer — recipient=${recipientCode} amountKobo=${amountKobo} reference=${stableKey}`,
		);

		const transfer = await paystack.transfer.initiate({
			amount: amountKobo,
			recipient: recipientCode,
			reason: "Wallet Withdrawal",
			reference: stableKey,
		});

		const transferCode = transfer?.data?.transfer_code;
		const transferStatus = transfer?.data?.status;

		if (!transferCode) {
			throw new Error("Paystack did not return a transfer_code");
		}

		logger.info(
			`[processSinglePayout] Transfer initiated — transferCode=${transferCode} status=${transferStatus}`,
		);

		payout.transactionRef = transferCode;
		payout.status = "processing";
		await payout.save();

		logger.info(
			`[processSinglePayout] SUCCESS — payoutId=${payout._id} transferCode=${transferCode}`,
		);

		return { success: true, payout };
	} catch (err) {
		logger.error(
			`[processSinglePayout] Transfer failed for payoutId=${payout._id}: ${err.message}`,
		);

		// Reverse ledger reserve — move money back from pending → available
		await ledgerService.reverseReserve(
			recipientId,
			userType,
			amount,
			`Withdrawal failed: ${err.message}`,
		);
		logger.info(
			`[processSinglePayout] Ledger reserve reversed for recipientId=${recipientId}`,
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

/**
 * Auto payouts are managed via internal wallets — no bank transfer on order completion.
 */
const processAutoPayoutsForOrder = async (orderId) => {
	logger.info(
		`[processAutoPayoutsForOrder] Skipping auto-bank transfer for orderId=${orderId} — funds managed in internal wallets`,
	);
	return { vendor: "MANAGED_IN_WALLET", rider: "MANAGED_IN_WALLET" };
};

/**
 * Retry a single pending payout by its payoutId.
 * FIX: now calls reserveBalance before initiating transfer (was missing before).
 */
const processPendingPayout = async (payoutId) => {
	logger.info(`[processPendingPayout] START — payoutId=${payoutId}`);

	const payout = await Payout.findById(payoutId);

	if (!payout) {
		logger.error(
			`[processPendingPayout] Payout not found — payoutId=${payoutId}`,
		);
		throw new Error(`processPendingPayout: payout ${payoutId} not found`);
	}

	if (payout.status !== "pending") {
		logger.warn(
			`[processPendingPayout] payoutId=${payoutId} has status='${payout.status}' — expected 'pending', skipping`,
		);
		return { success: false, reason: "not_pending", payout };
	}

	const { recipientId, recipientType, amount, bankDetails } = payout;

	logger.debug(
		`[processPendingPayout] recipientId=${recipientId} recipientType=${recipientType} amount=NGN${amount}`,
	);

	if (!bankDetails?.accountNumber || !bankDetails?.bankCode) {
		logger.warn(
			`[processPendingPayout] payoutId=${payoutId} has no bank details — cannot process`,
		);
		return { success: false, reason: "no_bank", payout };
	}

	const fees = calculateTotalFees(amount);
	const netAmount = amount - fees.total;

	if (netAmount <= 0) {
		logger.warn(
			`[processPendingPayout] Amount NGN${amount} cannot cover fees NGN${fees.total} — marking failed`,
		);
		payout.status = "failed";
		payout.failureReason = `Amount NGN ${amount} cannot cover fees of NGN ${fees.total}`;
		await payout.save();
		return { success: false, reason: "amount_too_low", payout };
	}

	// FIX: reserve balance before initiating transfer (was missing in original)
	logger.info(
		`[processPendingPayout] Reserving NGN${amount} in ledger for recipientId=${recipientId}`,
	);
	try {
		await ledgerService.reserveBalance(
			recipientId,
			recipientType === "VendorProfile" ? "VENDOR" : "RIDER",
			amount,
		);
		logger.info(
			`[processPendingPayout] Ledger reserve success for recipientId=${recipientId}`,
		);
	} catch (err) {
		logger.error(
			`[processPendingPayout] Ledger reserve failed for payoutId=${payoutId}: ${err.message}`,
		);
		return { success: false, reason: "insufficient_funds", payout };
	}

	try {
		const model =
			recipientType === "VendorProfile" ? VendorProfile : RiderProfile;
		const profile = await model.findById(recipientId);
		if (!profile) {
			throw new Error(`${recipientType} not found for id ${recipientId}`);
		}

		// Ensure idempotency key exists
		const stableKey = payout.idempotencyKey ?? `payout_pending_${payoutId}`;
		if (!payout.idempotencyKey) {
			payout.idempotencyKey = stableKey;
			await payout.save();
			logger.debug(
				`[processPendingPayout] Set idempotencyKey=${stableKey} on payoutId=${payoutId}`,
			);
		}

		const recipientCode = await ensureRecipientCode(
			profile,
			bankDetails,
			profile.name,
		);

		const amountKobo = Math.round(netAmount * 100);
		logger.info(
			`[processPendingPayout] Initiating Paystack transfer — recipient=${recipientCode} amountKobo=${amountKobo} reference=${stableKey}`,
		);

		const transfer = await paystack.transfer.initiate({
			amount: amountKobo,
			recipient: recipientCode,
			reason: "Wallet Withdrawal",
			reference: stableKey,
		});

		const transferCode = transfer?.data?.transfer_code;
		if (!transferCode) {
			throw new Error("Paystack did not return a transfer_code");
		}

		logger.info(
			`[processPendingPayout] Transfer initiated — transferCode=${transferCode} status=${transfer?.data?.status}`,
		);

		payout.transactionRef = transferCode;
		payout.feeDeducted = fees.total;
		payout.netAmount = netAmount;
		// intentionally stay "pending" — webhook promotes to "processed" on transfer.success
		await payout.save();

		logger.info(
			`[processPendingPayout] SUCCESS — payoutId=${payoutId} transferCode=${transferCode}`,
		);

		return { success: true, payout };
	} catch (err) {
		logger.error(
			`[processPendingPayout] Transfer failed for payoutId=${payoutId}: ${err.message}`,
		);

		// Reverse the reserve we just made
		await ledgerService.reverseReserve(
			recipientId,
			recipientType === "VendorProfile" ? "VENDOR" : "RIDER",
			amount,
			`Pending payout failed: ${err.message}`,
		);
		logger.info(
			`[processPendingPayout] Ledger reserve reversed for recipientId=${recipientId}`,
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

/**
 * Process all pending payouts for a user in FIFO order.
 * Stops early if insufficient funds are encountered.
 */
const processPendingPayoutsForUser = async (userId, userType) => {
	logger.info(
		`[processPendingPayoutsForUser] START — userType=${userType} userId=${userId}`,
	);

	// FIX: uses resolveProfile which correctly handles vendor `owner` field
	const profile = await resolveProfile(userId, userType);

	if (!profile) {
		logger.warn(
			`[processPendingPayoutsForUser] No ${userType} profile for userId=${userId}`,
		);
		return { processed: 0, results: [] };
	}

	const recipientType =
		userType === "VENDOR" ? "VendorProfile" : "RiderProfile";

	const pendingPayouts = await Payout.find({
		recipientId: profile._id,
		recipientType,
		status: "pending",
	}).sort({ createdAt: 1 });

	if (pendingPayouts.length === 0) {
		logger.info(
			`[processPendingPayoutsForUser] No pending payouts for ${userType} userId=${userId}`,
		);
		return { processed: 0, results: [] };
	}

	logger.info(
		`[processPendingPayoutsForUser] Found ${pendingPayouts.length} pending payout(s) for ${userType} userId=${userId}`,
	);

	const results = [];
	for (const payout of pendingPayouts) {
		logger.info(
			`[processPendingPayoutsForUser] Processing payoutId=${payout._id} amount=NGN${payout.amount}`,
		);
		const result = await processPendingPayout(payout._id);
		results.push({ payoutId: payout._id, ...result });

		if (result.reason === "insufficient_funds") {
			logger.warn(
				`[processPendingPayoutsForUser] Stopping — insufficient funds at payoutId=${payout._id}`,
			);
			break;
		}
	}

	const succeeded = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	logger.info(
		`[processPendingPayoutsForUser] DONE — ${succeeded} succeeded, ${failed} failed for ${userType} userId=${userId}`,
	);

	return { processed: results.length, succeeded, failed, results };
};

/**
 * Fetch user bank details.
 * FIX: vendors use `owner` field, not `user`.
 */
const getUserBankDetails = async (userId, userType = "RIDER") => {
	logger.debug(`[getUserBankDetails] userId=${userId} userType=${userType}`);

	const Model = userType === "VENDOR" ? VendorProfile : RiderProfile;
	// FIX: was always using { user: userId } — broke vendor lookups
	const userField = userType === "VENDOR" ? "owner" : "user";

	const profile = await Model.findOne({ [userField]: userId }).select(
		"bankDetails paystackRecipientCode",
	);

	if (!profile) {
		logger.warn(
			`[getUserBankDetails] No profile found for ${userType} userId=${userId}`,
		);
		return null;
	}

	if (!profile.bankDetails) {
		logger.warn(
			`[getUserBankDetails] Profile found but no bankDetails for ${userType} userId=${userId}`,
		);
		return null;
	}

	logger.debug(
		`[getUserBankDetails] Found bank details for ${userType} userId=${userId} — accountNumber=${profile.bankDetails.accountNumber} recipientCode=${profile.paystackRecipientCode || "none"}`,
	);

	return {
		accountNumber: profile.bankDetails.accountNumber,
		bankCode: profile.bankDetails.bankCode,
		bankName: profile.bankDetails.bankName,
		accountName: profile.bankDetails.accountName,
		paystackRecipientCode: profile.paystackRecipientCode || null,
	};
};

/**
 * Called by Paystack webhook on transfer.success.
 * Finalizes the ledger — debits pendingBalance (money has left the system).
 */
const handleTransferSuccess = async (transferCode) => {
	logger.info(`[handleTransferSuccess] transferCode=${transferCode}`);

	const payout = await Payout.findOne({ transactionRef: transferCode });
	if (!payout) {
		logger.warn(
			`[handleTransferSuccess] No payout found for transferCode=${transferCode}`,
		);
		return;
	}

	if (payout.status === "processed") {
		logger.warn(
			`[handleTransferSuccess] Already processed — payoutId=${payout._id} transferCode=${transferCode}`,
		);
		return;
	}

	logger.info(
		`[handleTransferSuccess] Completing ledger for payoutId=${payout._id} recipientId=${payout.recipientId} amount=NGN${payout.amount}`,
	);

	const ledgerType =
		payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";
	await ledgerService.completePayout(
		payout.recipientId,
		ledgerType,
		payout.amount,
	);

	payout.status = "processed";
	payout.processedAt = new Date();
	await payout.save();

	logger.info(
		`[handleTransferSuccess] DONE — payoutId=${payout._id} transferCode=${transferCode} amount=NGN${payout.amount} marked processed`,
	);
};

/**
 * Called by Paystack webhook on transfer.failed / transfer.reversed.
 * Moves money back from pending → available in the ledger.
 */
const handleTransferFailure = async (
	transferCode,
	reason = "Transfer failed",
) => {
	logger.info(
		`[handleTransferFailure] transferCode=${transferCode} reason="${reason}"`,
	);

	const payout = await Payout.findOne({ transactionRef: transferCode });
	if (!payout) {
		logger.warn(
			`[handleTransferFailure] No payout found for transferCode=${transferCode}`,
		);
		return;
	}

	if (payout.status === "failed") {
		logger.warn(
			`[handleTransferFailure] Already failed — payoutId=${payout._id} transferCode=${transferCode}`,
		);
		return;
	}

	logger.info(
		`[handleTransferFailure] Reversing ledger reserve for payoutId=${payout._id} recipientId=${payout.recipientId} amount=NGN${payout.amount}`,
	);

	const ledgerType =
		payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";
	await ledgerService.reverseReserve(
		payout.recipientId,
		ledgerType,
		payout.amount,
		reason,
	);

	payout.status = "failed";
	payout.failureReason = reason;
	await payout.save();

	logger.info(
		`[handleTransferFailure] DONE — payoutId=${payout._id} transferCode=${transferCode} amount=NGN${payout.amount} reversed`,
	);
};

module.exports = {
	processAutoPayoutsForOrder,
	processSinglePayout,
	processPendingPayout,
	processPendingPayoutsForUser,
	getUserBankDetails,
	handleTransferSuccess,
	handleTransferFailure,
};
