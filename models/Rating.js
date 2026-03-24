const mongoose = require("mongoose");

const ratingSchema = new mongoose.Schema(
	{
		targetType: {
			type: String,
			enum: ["FoodItem", "Combo", "VendorProfile", "RiderProfile", "Plate"],
			required: true,
		},
		target: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			refPath: "targetType",
		},
		orderId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Order",
			required: true,
		},
		customer: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Customer",
			required: true,
		},
		rating: {
			type: Number,
			min: 1,
			max: 5,
			required: true,
		},
		comment: String,
	},
	{ timestamps: true },
);

// One rating per customer per entity per order
ratingSchema.index(
	{ targetType: 1, target: 1, customer: 1, orderId: 1 },
	{ unique: true },
);

module.exports = mongoose.model("Rating", ratingSchema);
