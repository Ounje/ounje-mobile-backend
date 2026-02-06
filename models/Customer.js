const { AccountInstance } = require("twilio/lib/rest/api/v2010/account");
const User = require("./User");
const mongoose = require("mongoose");

const Customer = User.discriminator(
	"customer",
	new mongoose.Schema({
		wallet: { type: String, default: "null" },
		accountStatus: {
			type: String,
			enum: ["active", "suspended", "deactivated"],
			default: "active",
		},
	}),
);

module.exports = Customer;
