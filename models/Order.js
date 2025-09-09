const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  food: { type: mongoose.Schema.Types.ObjectId, ref: "Food", required: true },
  name: String,
  price: Number,
  quantity: { type: Number, default: 1 }
});

const orderSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  rider: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // assigned rider
  items: [orderItemSchema],
  totalPrice: Number,
  deliveryAddress: String,
  status: {
    type: String,
    enum: ["pending", "confirmed", "assigned", "out_for_delivery", "delivered", "cancelled"],
    default: "pending"
  },
  riderLocation: {
    lat: Number,
    lng: Number,
    updatedAt: Date
  }
}, { timestamps: true });

module.exports = mongoose.model("Order", orderSchema);
