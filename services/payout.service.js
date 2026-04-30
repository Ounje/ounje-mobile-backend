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
 * Transfer fee charged to the user per withdrawal (in KOBO).
 * Configurable via env. Default: ₦25 (2500 kobo) — standard Paystack band.
 */
const TRANSFER_FEE_KOBO = parseInt(process.env.TRANSFER_FEE_KOBO || "2500", 10);

/**
 * How long after a withdrawal request before it is actually processed (ms).
 * Default: 2 hours. Gives a window to catch fraud / chargebacks before funds leave.
 */
const WITHDRAWAL_HOLD_MS = parseInt(
	process.env.WITHDRAWAL_HOLD_MS || String(2 * 60 * 60 * 1000),
	10,
);

/**
 * Maximum retries before a queued payout is permanently failed.
 */
const MAX_RETRIES = 3;

// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

/**
 * Resolve VendorProfile or RiderProfile from a User._id.
 * Vendors are stored under `owner`, riders under `user`.
 */
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
 * Ensure a Paystack Transfer Recipient exists for the profile.
 * Creates one on first call and caches recipient_code on the profile.
 */
const _ensureRecipientCode = async (profile, bankDetails, name) => {
	if (profile.paystackRecipientCode) {
		logger.debug(
			`[_ensureRecipientCode] Using cached code=${profile.paystackRecipientCode}`,
		);
		return profile.paystackRecipientCode;
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

/**
 * Generate a unique, traceable withdrawal reference.
 * Format: WD-{VENDOR|RIDER}-{profileId last 6}-{timestamp}
 */
const _generateReference = (userType, profileId) => {
	const prefix = userType === "VENDOR" ? "WD-VND" : "WD-RDR";
	const suffix = String(profileId).slice(-6).toUpperCase();
	return `${prefix}-${suffix}-${Date.now()}`;
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * REQUEST WITHDRAWAL (user-initiated, on-demand)
 *
 * Validates ledger balance and Paystack balance, reserves funds,
 * and queues the withdrawal for processing after WITHDRAWAL_HOLD_MS.
 *
 * @param {string} userId       - User._id
 * @param {string} userType     - "VENDOR" | "RIDER"
 * @param {number} amountKobo   - Gross withdrawal amount in KOBO
 * @param {object} bankDetails  - { accountNumber, bankCode, accountName, bankName }
 * @param {string} name         - Account holder name
 *
 * @returns {{ success: boolean, payout?: object, reason?: string, detail?: string }}
 */
const requestWithdrawal = async ({
	userId,
	userType,
	amountKobo,
	bankDetails,
	name,
}) => {
	logger.info(
		`[requestWithdrawal] START — userType=${userType} userId=${userId} amountKobo=${amountKobo} (₦${amountKobo / 100})`,
	);

	// ── 1. Validate inputs ────────────────────────────────────────────────────
	if (!amountKobo || amountKobo <= 0) {
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

	const totalDebitKobo = amountKobo + TRANSFER_FEE_KOBO;
	const netAmountKobo = amountKobo; // net sent to bank (fee is separate deduction from available)

	logger.info(
		`[requestWithdrawal] Fee breakdown — gross=₦${amountKobo / 100} fee=₦${TRANSFER_FEE_KOBO / 100} totalDebit=₦${totalDebitKobo / 100} netSentToBank=₦${netAmountKobo / 100}`,
	);

	// ── 2. Resolve profile (recipientId = profile._id, not user._id) ──────────
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

	// ── 3. Check for concurrent pending withdrawal (double-spend guard) ────────
	const existingPending = await Payout.findOne({
		recipientId,
		recipientType,
		status: { $in: ["pending", "processing"] },
	});
	if (existingPending) {
		logger.warn(
			`[requestWithdrawal] Concurrent withdrawal detected — payoutId=${existingPending._id} status=${existingPending.status}`,
		);
		return {
			success: false,
			reason: "withdrawal_in_progress",
			detail:
				"You already have a pending withdrawal. Please wait for it to complete before requesting another.",
			payout: existingPending,
		};
	}

	// ── 4. Fetch authoritative ledger balance ─────────────────────────────────
	const balance = await ledgerService.getAccountBalance(recipientId, userType);

	logger.info(
		`[requestWithdrawal] Ledger balance — available=${balance.availableBalance} kobo (₦${balance.availableBalance / 100}) | requested+fee=${totalDebitKobo} kobo (₦${totalDebitKobo / 100})`,
	);

	if (balance.availableBalance < totalDebitKobo) {
		return {
			success: false,
			reason: "insufficient_funds",
			detail: `Insufficient balance. You need ₦${totalDebitKobo / 100} (₦${amountKobo / 100} + ₦${TRANSFER_FEE_KOBO / 100} fee). Available: ₦${balance.availableBalance / 100}`,
			availableBalance: balance.availableBalance,
		};
	}

	// ── 5. Check Paystack balance (Ounje must have enough to fund the transfer) ─
	let paystackBalanceKobo = 0;
	try {
		paystackBalanceKobo = await paystack.balance.fetch();
		logger.info(
			`[requestWithdrawal] Paystack balance=₦${paystackBalanceKobo / 100} | needed=₦${netAmountKobo / 100}`,
		);

		if (paystackBalanceKobo < netAmountKobo) {
			logger.error(
				`[requestWithdrawal] ⚠️ Paystack balance insufficient — balance=₦${paystackBalanceKobo / 100} needed=₦${netAmountKobo / 100}`,
			);
			return {
				success: false,
				reason: "platform_balance_insufficient",
				detail:
					"Withdrawals are temporarily unavailable. Please try again shortly or contact support.",
			};
		}
	} catch (err) {
		// If Paystack balance check fails, log and continue — don't block user
		// The cron will handle any transfer failure gracefully
		logger.warn(
			`[requestWithdrawal] Paystack balance check failed: ${err.message} — proceeding with caution`,
		);
	}

	// ── 6. Atomically reserve funds (available → pending in ledger) ────────────
	logger.info(
		`[requestWithdrawal] Reserving ${totalDebitKobo} kobo for recipientId=${recipientId}`,
	);

	let reserved;
	try {
		reserved = await ledgerService.reserveBalance(
			recipientId,
			userType,
			totalDebitKobo,
		);
		logger.info(
			`[requestWithdrawal] Reserve success — ledgerEntryId=${reserved.entry._id} remaining=₦${reserved.availableBalance / 100}`,
		);
	} catch (err) {
		logger.error(`[requestWithdrawal] Reserve failed: ${err.message}`);
		return {
			success: false,
			reason: "insufficient_funds",
			detail: err.message,
		};
	}

	// ── 7. Generate reference and create Payout record ─────────────────────────
	const reference = _generateReference(userType, recipientId);
	const idempotencyKey = `wd_${recipientId}_${Date.now()}`;
	const processAt = new Date(Date.now() + WITHDRAWAL_HOLD_MS);

	const payout = await Payout.create({
		recipientId,
		recipientType,
		amount: totalDebitKobo,
		feeDeducted: TRANSFER_FEE_KOBO,
		netAmount: netAmountKobo,
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
		`[requestWithdrawal] SUCCESS — payoutId=${payout._id} reference=${reference} processAt=${processAt.toISOString()} (in ${WITHDRAWAL_HOLD_MS / 60000} mins)`,
	);

	return { success: true, payout };
};

/**
 * PROCESS QUEUED WITHDRAWALS (cron job)
 *
 * Called by the cron every 15 minutes.
 * Finds all pending withdrawals where processAt ≤ now,
 * fires the Paystack transfer, then settles the ledger.
 *
 * Uses lockedAt for distributed-safe single processing.
 */
const processQueuedWithdrawals = async () => {
	logger.info("[processQueuedWithdrawals] START");

	let processed = 0;
	let failed = 0;

	while (true) {
		// Atomically claim a payout by setting lockedAt and status=processing
		const payout = await Payout.findOneAndUpdate(
			{
				status: "pending",
				processAt: { $lte: new Date() }, // time window has passed
				lockedAt: { $exists: false }, // not already being processed
				retryCount: { $lt: MAX_RETRIES },
			},
			{
				$set: {
					status: "processing",
					lockedAt: new Date(),
				},
			},
			{
				new: true,
				sort: { processAt: 1 }, // oldest first
			},
		);

		if (!payout) {
			logger.info("[processQueuedWithdrawals] No eligible payouts found");
			break;
		}

		logger.info(
			`[processQueuedWithdrawals] Processing payoutId=${payout._id} reference=${payout.reference} amountKobo=${payout.netAmount} (₦${payout.netAmount / 100})`,
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
				// Max retries exceeded — reverse reserve and permanently fail
				logger.warn(
					`[processQueuedWithdrawals] MAX_RETRIES (${MAX_RETRIES}) exceeded for payoutId=${payout._id} — reversing reserve`,
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
						`[processQueuedWithdrawals] Reserve reversed for payoutId=${payout._id}`,
					);
				} catch (reverseErr) {
					logger.error(
						`[processQueuedWithdrawals] CRITICAL — failed to reverse reserve for payoutId=${payout._id}: ${reverseErr.message}`,
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
				// Requeue for retry — back to pending, unlock
				const retryProcessAt = new Date(Date.now() + 15 * 60 * 1000); // retry in 15 min
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
					`[processQueuedWithdrawals] payoutId=${payout._id} requeued for retry ${newRetryCount}/${MAX_RETRIES} at ${retryProcessAt.toISOString()}`,
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
 * PRIVATE: Fire the actual Paystack transfer for a locked payout.
 * On success → debit ledger, mark payout success.
 * On failure → throws (caller handles retry/fail logic).
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

	// Resolve profile for recipient_code
	const Model =
		recipientType === "VendorProfile" ? VendorProfile : RiderProfile;
	const profile = await Model.findById(recipientId);
	if (!profile)
		throw new Error(`${recipientType} not found for id ${recipientId}`);

	// Ensure Paystack recipient exists
	const recipientCode = await _ensureRecipientCode(
		profile,
		bankDetails,
		profile.name,
	);

	logger.info(
		`[_fireTransfer] Initiating Paystack transfer — reference=${reference} recipient=${recipientCode} amountKobo=${netAmount} (₦${netAmount / 100})`,
	);

	// Fire transfer — netAmount is already in kobo, NO ×100 needed
	const transfer = await paystack.transfer.initiate({
		amount: netAmount, // kobo
		recipient: recipientCode,
		reason: "Wallet Withdrawal",
		reference,
		idempotencyKey,
	});

	const transferCode = transfer?.data?.transfer_code;
	if (!transferCode) throw new Error("Paystack did not return a transfer_code");

	logger.info(
		`[_fireTransfer] Transfer initiated — transferCode=${transferCode} status=${transfer?.data?.status}`,
	);

	// ── Settle ledger (debit pendingBalance — money has left the system) ──────
	const ledgerType = recipientType === "VendorProfile" ? "VENDOR" : "RIDER";
	const ledgerEntry = await ledgerService.completePayout(
		recipientId,
		ledgerType,
		payout.amount, // full reserved amount (gross + fee)
	);

	// ── Mark payout as success ─────────────────────────────────────────────────
	await Payout.findByIdAndUpdate(payout._id, {
		$set: {
			status: "success",
			transactionRef: transferCode,
			ledgerEntry: ledgerEntry.entry._id,
			processedAt: new Date(),
		},
		$unset: { lockedAt: "" },
	});

	logger.info(
		`[_fireTransfer]  SUCCESS — payoutId=${payout._id} transferCode=${transferCode} reference=${reference} amountSent=₦${netAmount / 100}`,
	);
};

/**
 * WEBHOOK: transfer.success
 * Safety net — if cron already marked success this is a no-op.
 * If somehow cron didn't settle the ledger, this will.
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
			`[handleTransferSuccess] Already marked success — payoutId=${payout._id}`,
		);
		return;
	}

	logger.info(
		`[handleTransferSuccess] Settling ledger for payoutId=${payout._id} amountKobo=${payout.amount}`,
	);

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
			`[handleTransferSuccess]  Settled — payoutId=${payout._id} amount=₦${payout.amount / 100}`,
		);
	} catch (err) {
		logger.error(
			`[handleTransferSuccess] Ledger settlement failed: ${err.message}`,
		);
	}
};

/**
 * WEBHOOK: transfer.failed / transfer.reversed
 * Returns reserved funds from pendingBalance → availableBalance.
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
			`[handleTransferFailure] Already marked failed — payoutId=${payout._id}`,
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
			`[handleTransferFailure] Reversed — payoutId=${payout._id} amount=₦${payout.amount / 100} returned to available`,
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
	TRANSFER_FEE_KOBO,
	WITHDRAWAL_HOLD_MS,
};
