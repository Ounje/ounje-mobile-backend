const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const userSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		email: { type: String, unique: true },
		address: { type: String, required: true }, // For Google Pricing Algorithm
		location: {
			type: { type: String, enum: ["Point"], default: "Point" },
			coordinates: { type: [Number] },
		},
		phone: Number,
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
	},
	{ timestamps: true, collection: "users" },
);

userSchema.index({ location: "2dsphere" });

userSchema.plugin(toJSON);

module.exports = mongoose.model("User", userSchema);
