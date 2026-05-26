const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const referralSchema = new mongoose.Schema(
	{
		// The user who owns/shared this code
		referrer: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},

		code: {
			type: String,
			required: true,
			unique: true,
		},

		// Everyone who signed up using this code
		referredUsers: [
			{
				user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
				joinedAt: { type: Date, default: Date.now },
				rewardGranted: { type: Boolean, default: false }, // referrer reward
				rewardGrantedAt: Date,
			},
		],

		// How many successful referrals (completed first order)
		successfulReferrals: { type: Number, default: 0 },

		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

referralSchema.plugin(toJSON);

module.exports = mongoose.model("Referral", referralSchema);
