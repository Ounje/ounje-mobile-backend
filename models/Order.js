const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  dish: { type: mongoose.Schema.Types.ObjectId, ref: "Dish", required: true },
  name: String,
  price: Number,
  quantity: { type: Number, default: 1 }
});

const orderSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "  Vendor", required: true },
  rider: { type: mongoose.Schema.Types.ObjectId, ref: "Rider", default: null }, // assigned rider
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
