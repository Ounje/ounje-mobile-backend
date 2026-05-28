const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const promotionSchema = new mongoose.Schema(
	{
		code: {
			type: String,
			required: true,
			unique: true,
			uppercase: true,
			trim: true,
		},
		name: {
			type: String,
			required: true,
			trim: true,
		},
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
		startsAt: { type: Date, default: Date.now },
		expiresAt: Date,
		isActive: { type: Boolean, default: true },
		status: {
			type: String,
			enum: ["pending_approval", "active", "inactive", "declined"],
			default: "active",
		},
		applicableTo: {
			type: String,
			enum: ["all", "Combo"],
			default: "all",
		},
		approvedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		approvedAt: { type: Date, default: null },
		declinedReason: { type: String, default: null },
		// Synced from admin portal schema
		createdByPortal: { type: String, default: "Operations" },
		isDeleted: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

promotionSchema.index({ code: 1, isActive: 1, status: 1 });

promotionSchema.plugin(toJSON);

// Explicit collection name to match admin portal
module.exports = mongoose.model("Promotion", promotionSchema, "promotions");
