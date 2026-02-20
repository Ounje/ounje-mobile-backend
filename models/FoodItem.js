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
		sideeImage: { type: String }, // subcategory image
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
		isCompulsory: { type: Boolean, required: true, default: false },
		preparationTime: { type: String, required: true },
		isAvailable: { type: Boolean, default: true },
		ordersCount: { type: Number, default: 0 },
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		minQuantity: { type: Number, default: 1 },
		maxQuantity: { type: Number, default: null },
	},
	{ timestamps: true },
);

FoodItemSchema.index(
	{
		name: "text",
		description: "text",
		category: "text",
		subCategory: "text",
	},
	{
		weights: {
			name: 10,
			category: 7,
			subCategory: 6,
			description: 5,
		},
		name: "fooditem_search_index",
	},
);
FoodItemSchema.plugin(toJSON);

module.exports = mongoose.model("FoodItem", FoodItemSchema);
