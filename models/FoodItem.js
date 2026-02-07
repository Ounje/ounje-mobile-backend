const mongoose = require("mongoose");
const {
	getCategoryValues,
	getSubCategoryValues,
	//getSellingUnitValues,
} = require("../utils/foodEnums");
const toJSON = require("./plugins/toJSON.plugin");

const FoodItemSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		price: { type: Number, required: true },
		img: { type: String, required: true },
		description: { type: String },
		vendor: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "VendorProfile",
			required: true,
		},
		category: {
			type: String,
			required: true,
			enum: getCategoryValues(),
		},
		subCategory: {
			type: String,
			enum: getSubCategoryValues(),
		},
		// sellingUnit: {
		// 	type: String,
		// 	required: true,
		// 	enum: getSellingUnitValues(),
		// },
		preparationTime: { type: String, required: true },
		isAvailable: { type: Boolean, default: true },
		ordersCount: { type: Number, default: 0 },
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Customer" }],
	},
	{ timestamps: true },
);

FoodItemSchema.plugin(toJSON);


module.exports = mongoose.model("FoodItem", FoodItemSchema);
