const mongoose = require("mongoose");

const dishSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  category: String,
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" , required: true },
  price: { type: Number, required: true },
  image: String,
  ordersCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  rating: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model("Dish", dishSchema);
