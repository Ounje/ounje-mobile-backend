const User = require("./User");
const mongoose = require("mongoose");

const Rider = User.discriminator("rider", new mongoose.Schema({
  isAvailable: { type: Boolean, default: true },
  operatingArea: [String]
}));

module.exports = Rider;
