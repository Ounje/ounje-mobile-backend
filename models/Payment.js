const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  reference: { type: String, unique: true, required: true },
  amount: { type: Number, required: true },
  authorizationUrl: { type: String },
  status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
  paidAt: Date,
}, { timestamps: true });

module.exports=  mongoose.model("Payment", paymentSchema);
