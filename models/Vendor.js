const User = require("./User");
const mongoose = require("mongoose");

const Vendor = User.discriminator("vendor", new mongoose.Schema({
  rating: { type: Number, default: 0 }
}));

module.exports = Vendor;
