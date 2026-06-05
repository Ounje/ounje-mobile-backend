const mongoose = require("mongoose");
const Payout = require("../models/Payout");
const VendorProfile = require("../models/VendorProfile");
const RiderProfile = require("../models/RiderProfile");
const paystack = require("../utils/paystack");
const ledgerService = require("./ledger.service");
const logger = require("../utils/logger");

if (!mongoose.models.VendorProfile) {
	try {
		require("../models/VendorProfile");
	} catch (e) {
		logger.warn("VendorProfile load error:", e.message);
	}
}
if (!mongoose.models.RiderProfile) {
	try {
		require("../models/RiderProfile");
	} catch (e) {
		logger.warn("RiderProfile load error:", e.message);
	}
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────

/**
 * How long after a withdrawal request before the Paystack transfer fires (ms).
 * Default: 1 minute.
 */
const WITHDRAWAL_HOLD_MS = parseInt(
	process.env.WITHDRAWAL_HOLD_MS || String(60 * 1000),
	10,
);

const MAX_RETRIES = 3;

// ─── FEE CALCULATOR ───────────────────────────────────────────────────────────

/**
 * Calculate Paystack transfer fee + 2026 EMTL stamp duty.
 * ALL AMOUNTS IN NAIRA.
 *
 * Paystack transfer fee bands:
 *   ≤ ₦5,000   → ₦10
 *   ≤ ₦50,000  → ₦25
 *   > ₦50,000  → ₦50
 *
 * 2026 stamp duty:
 *   ≥ ₦10,000  → ₦50
 *
 * @param {number} amount - in NAIRA
 * @returns {{ paystackFee: number, stampDuty: number, total: number }} all in NAIRA
 */
const calculateFees = (amount) => {
	let paystackFee = 0;

	if (amount <= 5000) {
		paystackFee = 10;
	} else if (amount <= 50000) {
		paystackFee = 25;
	} else {
		paystackFee = 50;
	}

	const stampDuty = amount >= 10000 ? 50 : 0;
	const total = paystackFee + stampDuty;

	logger.info(
		`[calculateFees] amount=₦${amount} paystackFee=₦${paystackFee} stampDuty=₦${stampDuty} totalFee=₦${total}`,
	);

	return { paystackFee, stampDuty, total };
};

// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

const _resolveProfile = async (userId, userType) => {
	const Model = userType === "VENDOR" ? VendorProfile : RiderProfile;
	const userField = userType === "VENDOR" ? "owner" : "user";

	logger.debug(
		`[_resolveProfile] userType=${userType} field=${userField} userId=${userId}`,
	);

	const profile = await Model.findOne({ [userField]: userId });
	if (!profile) {
		logger.warn(
			`[_resolveProfile] No ${userType} profile for userId=${userId}`,
		);
		return null;
	}

	logger.debug(`[_resolveProfile] Resolved profile._id=${profile._id}`);
	return profile;
};

/**
 * Ensure the profile has a valid Paystack recipient code.
 *
 * @param {object} profile - Mongoose profile document (VendorProfile or RiderProfile)
 * @param {object} bankDetails - { accountNumber, bankCode, bankName?, accountName? }
 * @param {string} name - display name for the recipient
 * @param {boolean} forceRecreate - if true, clears any cached code and creates a fresh one
 */
const _ensureRecipientCode = async (
	profile,
	bankDetails,
	name,
	forceRecreate = false,
) => {
	if (profile.paystackRecipientCode && !forceRecreate) {
		logger.debug(
			`[_ensureRecipientCode] Using cached code=${profile.paystackRecipientCode}`,
		);
		return profile.paystackRecipientCode;
	}

	if (forceRecreate && profile.paystackRecipientCode) {
		logger.warn(
			`[_ensureRecipientCode] Force-recreating — clearing stale code=${profile.paystackRecipientCode} for profile=${profile._id}`,
		);
		profile.paystackRecipientCode = undefined;
	}

	logger.info(
		`[_ensureRecipientCode] Creating Paystack recipient for profile=${profile._id}`,
	);

	const recipient = await paystack.recipients.create({
		name: name || profile.name || "Recipient",
		account_number: bankDetails.accountNumber,
		bank_code: bankDetails.bankCode,
	});

	const code = recipient?.data?.recipient_code;
	if (!code) throw new Error("Paystack did not return a recipient_code");

	profile.paystackRecipientCode = code;
	await profile.save();

	logger.info(
		`[_ensureRecipientCode] Created and saved recipient_code=${code}`,
	);
	return code;
};

const _generateReference = (userType, profileId) => {
	const prefix = userType === "VENDOR" ? "WD-VND" : "WD-RDR";
	const suffix = String(profileId).slice(-6).toUpperCase();
	return `${prefix}-${suffix}-${Date.now()}`;
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * REQUEST WITHDRAWAL (user-initiated, on-demand)
 *
 * @param {number} amount - in NAIRA (frontend sends naira, we store naira)
 */
const requestWithdrawal = async ({
	userId,
	userType,
	amount,
	bankDetails,
	name,
}) => {
	logger.info(
		`[requestWithdrawal] START — userType=${userType} userId=${userId} amount=₦${amount}`,
	);

	// ── 1. Validate inputs ────────────────────────────────────────────────────
	if (!amount || amount <= 0) {
		return {
			success: false,
			reason: "invalid_amount",
			detail: "Amount must be greater than 0",
		};
	}
	if (!bankDetails?.accountNumber || !bankDetails?.bankCode) {
		return {
			success: false,
			reason: "no_bank",
			detail: "Bank details required",
		};
	}

	// ── 2. Calculate fees (naira) ─────────────────────────────────────────────
	const fees = calculateFees(amount);
	const totalDebit = amount; // what leaves available balance (amount entered is gross debit)
	const netAmount = Math.max(0, amount - fees.total); // what lands in their bank after deducting fees

	logger.info(
		`[requestWithdrawal] Fees — gross=₦${amount} paystackFee=₦${fees.paystackFee} stampDuty=₦${fees.stampDuty} totalFee=₦${fees.total} totalDebit=₦${totalDebit} netSentToBank=₦${netAmount}`,
	);

	// ── 3. Resolve profile ────────────────────────────────────────────────────
	const profile = await _resolveProfile(userId, userType);
	if (!profile) {
		return {
			success: false,
			reason: "profile_not_found",
			detail: `${userType} profile not found for userId=${userId}`,
		};
	}

	const recipientId = profile._id;
	const recipientType =
		userType === "VENDOR" ? "VendorProfile" : "RiderProfile";

	// ── 4. Double-spend guard ─────────────────────────────────────────────────
	const existingPending = await Payout.findOne({
		recipientId,
		recipientType,
		status: { $in: ["pending", "processing"] },
	});
	if (existingPending) {
		logger.warn(
			`[requestWithdrawal] Concurrent withdrawal — payoutId=${existingPending._id} status=${existingPending.status}`,
		);
		return {
			success: false,
			reason: "withdrawal_in_progress",
			detail:
				"You already have a pending withdrawal. Please wait for it to complete.",
			payout: existingPending,
		};
	}

	// ── 5. Ledger balance check (authoritative) ───────────────────────────────
	const balance = await ledgerService.getAccountBalance(recipientId, userType);

	logger.info(
		`[requestWithdrawal] Balance — available=₦${balance.availableBalance} | needed=₦${totalDebit}`,
	);

	if (balance.availableBalance < totalDebit) {
		return {
			success: false,
			reason: "insufficient_funds",
			detail: `Insufficient balance. You requested ₦${amount} (which includes ₦${fees.total} in fees). Available balance: ₦${balance.availableBalance}`,
			availableBalance: balance.availableBalance,
			fees,
		};
	}

	// ── 6. Paystack balance check ─────────────────────────────────────────────
	try {
		// Paystack balance API returns kobo — convert to naira for comparison
		const paystackBalanceKobo = await paystack.balance.fetch();
		const paystackBalanceNaira = paystackBalanceKobo / 100;

		logger.info(
			`[requestWithdrawal] Paystack balance=₦${paystackBalanceNaira} | needed=₦${netAmount}`,
		);

		if (paystackBalanceNaira < netAmount) {
			logger.error(
				`[requestWithdrawal] ⚠️ Paystack balance insufficient — balance=₦${paystackBalanceNaira} needed=₦${netAmount}`,
			);
			return {
				success: false,
				reason: "platform_balance_insufficient",
				detail:
					"Withdrawals are temporarily unavailable. Please try again shortly or contact support.",
			};
		}
	} catch (err) {
		logger.warn(
			`[requestWithdrawal] Paystack balance check failed: ${err.message} — proceeding`,
		);
	}

	// ── 7. Reserve funds in ledger (available → pending) ─────────────────────
	logger.info(
		`[requestWithdrawal] Reserving ₦${totalDebit} for recipientId=${recipientId}`,
	);

	let reserved;
	try {
		reserved = await ledgerService.reserveBalance(
			recipientId,
			userType,
			totalDebit,
		);
		logger.info(
			`[requestWithdrawal] Reserve success — ledgerEntryId=${reserved.entry._id} remaining=₦${reserved.availableBalance}`,
		);
	} catch (err) {
		logger.error(`[requestWithdrawal] Reserve failed: ${err.message}`);
		return {
			success: false,
			reason: "insufficient_funds",
			detail: err.message,
		};
	}

	// ── 8. Create Payout record ────────────────────────────────────────────────
	const reference = _generateReference(userType, recipientId);
	const idempotencyKey = `wd_${recipientId}_${Date.now()}`;
	const processAt = new Date(Date.now() + WITHDRAWAL_HOLD_MS);

	const payout = await Payout.create({
		recipientId,
		recipientType,
		amount: totalDebit, // naira — gross amount reserved
		feeDeducted: fees.total, // naira — fee charged to user
		netAmount, // naira — what lands in bank
		status: "pending",
		bankDetails: {
			bankName: bankDetails.bankName || "",
			accountNumber: bankDetails.accountNumber,
			accountName: bankDetails.accountName || "",
			bankCode: bankDetails.bankCode,
		},
		reference,
		idempotencyKey,
		ledgerEntry: reserved.entry._id,
		processAt,
		retryCount: 0,
	});

	logger.info(
		`[requestWithdrawal] SUCCESS — payoutId=${payout._id} reference=${reference} processAt=${processAt.toISOString()} gross=₦${amount} fee=₦${fees.total} net=₦${netAmount}`,
	);

	return { success: true, payout, fees };
};

/**
 * PROCESS QUEUED WITHDRAWALS (cron — every 15 minutes)
 */
const processQueuedWithdrawals = async () => {
	logger.info("[processQueuedWithdrawals] START");

	// Unlock payouts stuck in "processing" > 15 min (crash recovery)
	const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
	const unlocked = await Payout.updateMany(
		{ status: "processing", lockedAt: { $lt: staleThreshold } },
		{
			$set: { status: "pending", processAt: new Date() },
			$unset: { lockedAt: "" },
		},
	);
	if (unlocked.modifiedCount > 0) {
		logger.warn(
			`[processQueuedWithdrawals] Unlocked ${unlocked.modifiedCount} stale payout(s)`,
		);
	}

	let processed = 0;
	let failed = 0;

	while (true) {
		const payout = await Payout.findOneAndUpdate(
			{
				status: "pending",
				processAt: { $lte: new Date() },
				lockedAt: { $exists: false },
				retryCount: { $lt: MAX_RETRIES },
			},
			{
				$set: { status: "processing", lockedAt: new Date() },
			},
			{ new: true, sort: { processAt: 1 } },
		);

		if (!payout) {
			logger.info("[processQueuedWithdrawals] No eligible payouts found");
			break;
		}

		logger.info(
			`[processQueuedWithdrawals] Processing payoutId=${payout._id} reference=${payout.reference} gross=₦${payout.amount} fee=₦${payout.feeDeducted} net=₦${payout.netAmount}`,
		);

		try {
			await _fireTransfer(payout);
			processed++;
		} catch (err) {
			logger.error(
				`[processQueuedWithdrawals] payoutId=${payout._id} error: ${err.message}`,
			);

			const newRetryCount = (payout.retryCount || 0) + 1;

			if (newRetryCount >= MAX_RETRIES) {
				logger.warn(
					`[processQueuedWithdrawals] MAX_RETRIES exceeded for payoutId=${payout._id} — reversing reserve`,
				);

				try {
					const ledgerType =
						payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";
					await ledgerService.reverseReserve(
						payout.recipientId,
						ledgerType,
						payout.amount,
						`Max retries exceeded: ${err.message}`,
					);
					logger.info(
						`[processQueuedWithdrawals] Reserve reversed — ₦${payout.amount} returned to available`,
					);
				} catch (reverseErr) {
					logger.error(
						`[processQueuedWithdrawals] CRITICAL — reversal failed: ${reverseErr.message}`,
					);
				}

				await Payout.findByIdAndUpdate(payout._id, {
					$set: {
						status: "failed",
						failureReason: `Max retries (${MAX_RETRIES}) exceeded: ${err.message}`,
						retryCount: newRetryCount,
						lastRetryAt: new Date(),
						processedAt: new Date(),
					},
					$unset: { lockedAt: "" },
				});
			} else {
				const retryProcessAt = new Date(Date.now() + 15 * 60 * 1000);
				await Payout.findByIdAndUpdate(payout._id, {
					$inc: { retryCount: 1 },
					$set: {
						status: "pending",
						lastRetryAt: new Date(),
						processAt: retryProcessAt,
					},
					$unset: { lockedAt: "" },
				});
				logger.info(
					`[processQueuedWithdrawals] payoutId=${payout._id} requeued ${newRetryCount}/${MAX_RETRIES}`,
				);
			}

			failed++;
		}
	}

	logger.info(
		`[processQueuedWithdrawals] DONE — processed=${processed} failed=${failed}`,
	);
	return { processed, failed };
};

/**
 * PRIVATE: Fire the actual Paystack transfer.
 *
 * Amount is stored in NAIRA.
 * Paystack expects KOBO → multiply by 100 HERE and only here.
 *
 * If Paystack rejects the recipient code as invalid (stale/deleted/wrong env),
 * the cached code is cleared, a fresh recipient is created, and the transfer
 * is retried once before propagating the error.
 */
const _fireTransfer = async (payout) => {
	const {
		recipientId,
		recipientType,
		netAmount,
		bankDetails,
		reference,
		idempotencyKey,
	} = payout;

	const Model =
		recipientType === "VendorProfile" ? VendorProfile : RiderProfile;
	const profile = await Model.findById(recipientId);
	if (!profile)
		throw new Error(`${recipientType} not found for id ${recipientId}`);

	const _attemptTransfer = async (recipientCode) => {
		logger.info(
			`[_fireTransfer] Initiating — reference=${reference} recipient=${recipientCode} netAmount=₦${netAmount}`,
		);
		//  Only place naira → kobo conversion happens: Paystack API requires kobo
		return paystack.transfer.initiate({
			amount: Math.round(netAmount * 100),
			recipient: recipientCode,
			reason: "Wallet Withdrawal",
			reference,
			idempotencyKey,
		});
	};

	let recipientCode = await _ensureRecipientCode(
		profile,
		bankDetails,
		profile.name,
	);

	let transfer;
	try {
		transfer = await _attemptTransfer(recipientCode);
	} catch (err) {
		const isInvalidRecipient =
			err.message?.toLowerCase().includes("recipient") &&
			err.message?.toLowerCase().includes("invalid");

		if (!isInvalidRecipient) throw err;

		// Stale or deleted recipient code — recreate and retry once
		logger.warn(
			`[_fireTransfer] Invalid recipient code=${recipientCode} — recreating for profile=${profile._id}`,
		);
		recipientCode = await _ensureRecipientCode(
			profile,
			bankDetails,
			profile.name,
			true, // forceRecreate
		);
		// If this also fails, the error propagates naturally to the retry loop
		transfer = await _attemptTransfer(recipientCode);
	}

	const transferCode = transfer?.data?.transfer_code;
	if (!transferCode) throw new Error("Paystack did not return a transfer_code");

	logger.info(
		`[_fireTransfer] Transfer initiated — transferCode=${transferCode}`,
	);

	// Save transferCode, update status to processing, and release lock.
	// We DO NOT complete the payout in the ledger here. That is done in handleTransferSuccess webhook.
	await Payout.findByIdAndUpdate(payout._id, {
		$set: { 
			transactionRef: transferCode,
			status: "processing",
			processedAt: new Date()
		},
		$unset: { lockedAt: "" },
	});

	logger.info(
		`[_fireTransfer] ✅ INITIATED — payoutId=${payout._id} transferCode=${transferCode} netSent=₦${netAmount} fee=₦${payout.feeDeducted} (awaiting Paystack webhook)`,
	);
};

/**
 * WEBHOOK: transfer.success — safety net if cron already settled, this is a no-op.
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
	if (payout.status === "success") {
		logger.info(
			`[handleTransferSuccess] Already success — payoutId=${payout._id}`,
		);
		return;
	}

	const ledgerType =
		payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";

	try {
		const ledgerEntry = await ledgerService.completePayout(
			payout.recipientId,
			ledgerType,
			payout.amount,
		);

		await Payout.findByIdAndUpdate(payout._id, {
			$set: {
				status: "success",
				ledgerEntry: ledgerEntry.entry._id,
				processedAt: new Date(),
			},
			$unset: { lockedAt: "" },
		});

		logger.info(
			`[handleTransferSuccess] ✅ Settled — payoutId=${payout._id} ₦${payout.amount}`,
		);
	} catch (err) {
		logger.error(`[handleTransferSuccess] Settlement failed: ${err.message}`);
	}
};

/**
 * WEBHOOK: transfer.failed / transfer.reversed
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
		logger.info(
			`[handleTransferFailure] Already failed — payoutId=${payout._id}`,
		);
		return;
	}

	const ledgerType =
		payout.recipientType === "VendorProfile" ? "VENDOR" : "RIDER";

	try {
		await ledgerService.reverseReserve(
			payout.recipientId,
			ledgerType,
			payout.amount,
			reason,
		);

		await Payout.findByIdAndUpdate(payout._id, {
			$set: {
				status: "failed",
				failureReason: reason,
				processedAt: new Date(),
			},
			$unset: { lockedAt: "" },
		});

		logger.info(
			`[handleTransferFailure] ✅ Reversed — ₦${payout.amount} returned to available`,
		);
	} catch (err) {
		logger.error(`[handleTransferFailure] Reversal failed: ${err.message}`);
	}
};

module.exports = {
	requestWithdrawal,
	processQueuedWithdrawals,
	handleTransferSuccess,
	handleTransferFailure,
	WITHDRAWAL_HOLD_MS,
	calculateFees,
};
