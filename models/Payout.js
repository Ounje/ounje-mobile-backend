const mongoose = require("mongoose");

const payoutSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      refPath: "userType",
    },
    userType: {
      type: String,
      enum: ["VENDOR", "RIDER"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    bankDetails: {
      accountNumber: { type: String, required: true },
      bankCode: { type: String, required: true },
      accountName: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "cancelled"],
      default: "pending",
    },
    ledgerEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
    },
    transactionRef: String,
    idempotencyKey: { type: String },
    failureReason: String,
    processedAt: Date,
  },
  { timestamps: true }
);

payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ user: 1, userType: 1, status: 1 });

module.exports = mongoose.model("Payout", payoutSchema);
