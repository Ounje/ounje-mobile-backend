const mongoose = require("mongoose");

/**
 * Payout (Withdrawal) Model
 *
 * Represents a vendor or rider withdrawal request.
 *
 *   All monetary amounts stored in KOBO (naira × 100).
 *
 * Status lifecycle:
 *   pending   → withdrawal queued, balance reserved, awaiting processAt time
 *   processing → cron picked it up, Paystack transfer in-flight
 *   success   → Paystack transfer confirmed, ledger debited
 *   failed    → Paystack transfer failed, ledger reserve reversed
 *   cancelled → user or admin cancelled before processing
 */
const payoutSchema = new mongoose.Schema(
	{
		recipientType: {
			type: String,
			enum: ["VendorProfile", "RiderProfile"],
			required: true,
		},
		recipientId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			refPath: "recipientType",
		},

		// ── Amounts (all in KOBO) ──────────────────────────────────────────────
		amount: { type: Number, required: true, min: 1 }, // gross requested amount (kobo)
		feeDeducted: { type: Number, required: true, default: 0 }, // transfer fee (kobo)
		netAmount: { type: Number, required: true, min: 1 }, // amount sent to bank (kobo)

		// ── Status ───────────────────────────────────────────────────────────
		status: {
			type: String,
			enum: ["pending", "processing", "success", "failed", "cancelled"],
			default: "pending",
		},

		// ── Bank destination ─────────────────────────────────────────────────
		bankDetails: {
			bankName: { type: String, default: "" },
			accountNumber: { type: String, required: true },
			accountName: { type: String, default: "" },
			bankCode: { type: String, required: true },
		},

		// ── References & traceability ─────────────────────────────────────────
		reference: { type: String }, // Ounje's unique ref
		transactionRef: { type: String }, // Paystack transfer_code
		ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" }, // debit entry (set on success)
		idempotencyKey: { type: String, unique: true, sparse: true },

		// ── Scheduling ────────────────────────────────────────────────────────
		// When the cron job should fire the Paystack transfer.
		// Set to now + WITHDRAWAL_HOLD_MS at request time.
		processAt: { type: Date, required: true },

		// ── Cron locking (prevents concurrent processing) ─────────────────────
		lockedAt: { type: Date },

		// ── Retry ────────────────────────────────────────────────────────────
		retryCount: { type: Number, default: 0 },
		lastRetryAt: { type: Date },

		// ── Outcome ──────────────────────────────────────────────────────────
		failureReason: { type: String },
		processedAt: { type: Date },
	},
	{ timestamps: true },
);

payoutSchema.index({ status: 1, processAt: 1 }); // cron query
payoutSchema.index({ recipientId: 1, recipientType: 1 });
payoutSchema.index({ transactionRef: 1 }, { sparse: true });
payoutSchema.index({ reference: 1 }, { unique: true, sparse: true });
payoutSchema.index({ lockedAt: 1 }, { sparse: true });

module.exports = mongoose.model("Payout", payoutSchema);
