const User = require("./User");
const mongoose = require("mongoose");

const Rider = User.discriminator("rider", new mongoose.Schema({
  isAvailable: { type: Boolean, default: true },
  operatingArea: [String],

  // Bank and payout recipient info
  bankDetails: {
    accountNumber: String,
    bankCode: String,
    accountName: String,
  },
  paystackRecipientCode: String,
}));

module.exports = Rider;
