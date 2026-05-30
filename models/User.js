const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const userSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		email: String,
		address: { type: String, required: true },
		location: {
			type: { type: String, enum: ["Point"], default: "Point" },
			coordinates: { type: [Number] },
		},
		phone: {
			type: String,
			match: [/^\+?[1-9]\d{1,14}$/, "Please provide a valid E.164 phone number"],
		},
		role: {
			type: String,
			enum: ["customer", "vendor", "rider", "admin"],
			required: true,
		},
		img: String,
		fcmToken: {
			type: String,
			default: null,
		},
		googleId: { type: String, unique: true, sparse: true },
		appleId: { type: String, unique: true, sparse: true },
		authProvider: { type: String, enum: ["local", "google", "apple"], default: "local" },
	},
	{ timestamps: true, collection: "users" },
);

userSchema.plugin(toJSON);

module.exports = mongoose.model("User", userSchema);
