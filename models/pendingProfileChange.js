const mongoose = require("mongoose");

const pendingProfileChangeSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		otp: { type: String, required: true },
		otpExpiresAt: { type: Date, required: true },
		pendingEmail: { type: String },
		pendingPhone: { type: Number },
		verified: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

module.exports = mongoose.model(
	"PendingProfileChange",
	pendingProfileChangeSchema,
);
