const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const promotionSchema = new mongoose.Schema(
	{
		code: { type: String, required: true, unique: true, uppercase: true },
		name: { type: String, required: true }, // Added for Admin parity
		description: String,
		type: {
			type: String,
			enum: ["percentage", "fixed_amount"],
			required: true,
		},
		value: { type: Number, required: true },
		maxDiscount: Number,
		minOrderValue: { type: Number, default: 0 },
		usageLimit: Number,
		usedCount: { type: Number, default: 0 },
		usedBy: {
			type: [mongoose.Schema.Types.ObjectId],
			ref: "User",
			default: [],
		},
		startsAt: Date,
		expiresAt: Date,
		isActive: { type: Boolean, default: true },
		status: {
			type: String,
			enum: ["pending_approval", "active", "inactive", "declined"],
			default: "active", // Default to active for mobile-created if any
		},
		applicableTo: {
			type: String,
			enum: ["all", "combo"],
			default: "all",
		},
		approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
		approvedAt: Date,
		declinedReason: String,
	},
	{ timestamps: true },
);

promotionSchema.plugin(toJSON);

module.exports = mongoose.model("Promotion", promotionSchema);