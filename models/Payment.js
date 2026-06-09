const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  reference: { type: String, unique: true, required: true },
  amount: { type: Number, required: true },
  authorizationUrl: { type: String },
  paymentChannel: { type: String, default: null },
  paymentBank: { type: String, default: null },
  paystackCustomerCode: { type: String, default: null },
  status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
  paidAt: Date,
}, { timestamps: true });

module.exports = mongoose.model("Payment", paymentSchema);
