const User = require("./User");
const mongoose = require("mongoose");

const Customer = User.discriminator("customer", new mongoose.Schema({
  wallet: {type: String, default: "null"}
}));

module.exports = Customer;
