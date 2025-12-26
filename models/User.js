const mongoose = require("mongoose");
const options = {discriminatorKey: "role", collection: "users"}

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  address: { type: String, required: true }, // For Google Pricing Algorithm
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], index: "2dsphere" }
  },
  phone: Number,
  img: String,
}, { timestamps: true,
  ...options
 });


module.exports = mongoose.model("User", userSchema);
