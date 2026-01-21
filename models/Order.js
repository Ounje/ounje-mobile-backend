const mongoose = require("mongoose");
const Plate = require("./Plate");
const FoodItem = require("./FoodItem");
const Dish = require("./Combo");

const orderSchema = new mongoose.Schema({
	customer: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "customer",
		required: true,
	},
	vendor: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Vendor",
		required: true,
	},
	items: [
		{
			itemType: {
				type: String,
				enum: ["FoodItem", "Combo", "Plate"],
				required: true,
			},
			item: {
				type: mongoose.Schema.Types.ObjectId,
				required: true,
				refPath: "items.itemType", // <-- Dynamic reference
			},
			quantity: {
				type: Number,
				default: 1,
				min: 1,
			},
			price: {
				type: Number,
				required: true,
			},
			notes: String, // optional instructions
		},
	],
	totalPrice: {
		type: Number,
		required: true,
	},
	// foodTotal: {
	//   type: Number,
	//   required: true
	// },
	deliveryFee: {
		type: Number,
		required: true,
	},
	zone: {
		type: String,
	}, // e.g., "Ikeja"
	deliveryLatitude: Number,
	deliveryLongitude: Number,
	rider: { type: mongoose.Schema.Types.ObjectId, ref: "rider" },
	status: {
		type: String,
		enum: [
			"pending",
			"confirmed",
			"assigned",
			"out_for_delivery",
			"delivered",
			"in_progress",
			"completed",
			"cancelled",
		],
		default: "pending",
	},
	subStatus: { type: String, default: "" }, // for more granular tracking if needed
	deliveryAddress: {
		type: String,
	},

	// Delivery OTP & confirmation (in-app flow)
	deliveryOtpCode: String, // plaintext short-lived code (visible to customer in-app)
	deliveryOtpHash: String, // sha256 hash of OTP (optional extra safety)
	deliveryOtpSentAt: Date,
	deliveryOtpExpiresAt: Date,
	deliveryConfirmedAt: Date,
	deliveryConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "rider" },
	paymentStatus: {
		type: String,
		enum: ["unpaid", "paid", "refunded"],
		default: "unpaid",
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
});

module.exports = mongoose.model("Order", orderSchema);
