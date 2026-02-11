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
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    feeDeducted: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
      required: true,
    },
    bankDetails: {
      accountNumber: { type: String },
      bankCode: { type: String },
      accountName: { type: String },
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
