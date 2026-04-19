const mongoose = require("mongoose");

const TYPES = [
	"new_order",
	"order_cancelled",
	"payout_completed",
	"payout_failed",
	"newsflash",
	"account_suspended",
	"vendor_accepted_order",
	"vendor_declined_order",
	"order_preparing",
	"food_ready",
	"ready_for_pickup",
	"order_delivered",
	"rider_assigned",
	"order_picked_up",
	"promo_applied",
];

const notificationSchema = new mongoose.Schema(
	{
		recipient: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			index: true,
		},
		recipientModel: {
			type: String,
			enum: ["vendor", "customer", "rider"],
			required: true,
		},
		type: { type: String, enum: TYPES, required: true },
		title: { type: String, required: true },
		message: { type: String, required: true },
		data: { type: Object, default: {} },
		isRead: { type: Boolean, default: false },
		priority: {
			type: String,
			enum: ["low", "medium", "high", "urgent"],
			default: "medium",
		},
	},
	{ timestamps: true },
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index(
	{ createdAt: 1 },
	{ expireAfterSeconds: 60 * 60 * 24 * 30 },
);

module.exports = mongoose.model("Notification", notificationSchema);
