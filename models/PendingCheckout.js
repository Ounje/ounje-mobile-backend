const mongoose = require("mongoose");

/**
 * Temporary store for cart data during Paystack checkout.
 * Created when payment is initiated (no order yet), deleted when payment is verified
 * and the order is created. Auto-expires after 30 minutes via TTL index.
 */
const PendingCheckoutSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    cartData: {
      vendorId: { type: String, required: true },
      deliveryAddress: { type: String, required: true },
      items: { type: Array, required: true },
      vendorNote: { type: String, default: "" },
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 60 * 1000), // 30 min
    },
  },
  { timestamps: true },
);

// MongoDB TTL — document is deleted automatically when expiresAt is reached
PendingCheckoutSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PendingCheckout", PendingCheckoutSchema);
