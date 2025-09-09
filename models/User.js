const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["customer", "seller", "rider"], default: "customer" },
  location: String,      // free text or geo JSON later
  phone: Number,
  // For riders you might want to store availability and current coordinates
  riderStatus: {
    available: { type: Boolean, default: false },
    lastLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date
    }
  }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
