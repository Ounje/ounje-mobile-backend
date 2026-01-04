const User = require("./User");
const mongoose = require("mongoose");

const Rider = User.discriminator("rider", new mongoose.Schema({
  isAvailable: { type: Boolean, default: true },
  operatingArea: [String],

  // Geospatial searches
  lastKnownLocation: {
    type: { type: String, default: "Point" },
    coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
  },

  // Bank and payout recipient info
  bankDetails: {
    accountNumber: String,
    bankCode: String,
    accountName: String,
  },
  paystackRecipientCode: String,
}));

// Creates the index so MongoDB can search by distance
Rider.schema.index({ lastKnownLocation: "2dsphere" });

module.exports = Rider;
