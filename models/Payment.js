import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  reference: { type: String, unique: true, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
  paidAt: Date,
}, { timestamps: true });

export default mongoose.model("Payment", paymentSchema);
