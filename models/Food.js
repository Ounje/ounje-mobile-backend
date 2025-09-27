const mongoose = require("mongoose");

const foodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" , required: true },
  price: { type: Number, required: true },
  image: String,
  isActive: { type: Boolean, default: true },
  rating: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model("Food", foodSchema);
