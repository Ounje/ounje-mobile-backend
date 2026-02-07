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
      enum: ["pending", "processed", "failed"],
      default: "pending",
    },
    // OPTION A: Stored Details (Acceptable for Payouts, NOT Payments)
    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
    },
    // OPTION B: Tokenized (Best Practice)
    providerRecipientCode: String,
    reference: String,
    processedAt: Date,
  },
  { timestamps: true }
);

payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ recipientId: 1, recipientType: 1 });

module.exports = mongoose.model("Payout", payoutSchema);
