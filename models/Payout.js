const mongoose = require("mongoose");

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
		amount: {
			type: Number,
			required: true,
			min: 0,
		},
		status: {
			type: String,
			enum: ["pending", "processing", "processed", "failed", "cancelled"],
			default: "pending",
		},
		bankDetails: {
			bankName: String,
			accountNumber: String,
			accountName: String,
			bankCode: String,
		},
		feeDeducted: { type: Number, default: 0 },
		netAmount: { type: Number },
		idempotencyKey: { type: String, unique: true, sparse: true },
		transactionRef: { type: String },
		ledgerEntry: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" },
		failureReason: { type: String },
		providerRecipientCode: String,
		processedAt: Date,
	},
	{ timestamps: true },
);

payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ recipientId: 1, recipientType: 1 });
payoutSchema.index({ transactionRef: 1 }, { sparse: true });

module.exports = mongoose.model("Payout", payoutSchema);
