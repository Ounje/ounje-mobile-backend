const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const customerSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		name: { type: String },
		phone: { type: Number },
		fcmToken: { type: String },
		isActive: { type: Boolean, default: true },
		savedAddresses: [
			{
				label: { type: String, required: true }, // e.g., "Home", "Work"
				address: { type: String, required: true },
				coordinates: { type: [Number], index: "2dsphere" }, // [longitude, latitude]
				details: String, // Apt number, instructions
			},
		],
		preferences: {
			marketingEmails: { type: Boolean, default: true },
			pushNotifications: { type: Boolean, default: true },
		},
	},
	{ timestamps: true },
);

customerSchema.plugin(toJSON);

module.exports = mongoose.model("Customer", customerSchema);
