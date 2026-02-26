const mongoose = require("mongoose");
const {
	getCategoryValues,
	getSubCategoryValues,
} = require("../utils/foodEnums");
const toJSON = require("./plugins/toJSON.plugin");

const SubCategoryItemSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		price: { type: Number, required: true },
		img: { type: String, required: true },
		description: { type: String },
		preparationTime: { type: String },
		minQuantity: { type: Number, default: 1 },
		maxQuantity: { type: Number, default: null },
		isAvailable: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

const SubCategorySchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			enum: getSubCategoryValues(),
		},
		items: [SubCategoryItemSchema],
	},
	{ timestamps: true },
);

const FoodItemSchema = new mongoose.Schema(
	{
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
		subCategory: [SubCategorySchema],
		isCompulsory: { type: Boolean, default: false },
		isAvailable: { type: Boolean, default: true },
		ordersCount: { type: Number, default: 0 },
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
	},
	{ timestamps: true },
);

FoodItemSchema.index(
	{
		category: "text",
		"subCategory.name": "text",
		"subCategory.items.name": "text",
		"subCategory.items.description": "text",
	},
	{
		weights: {
			category: 7,
			"subCategory.name": 6,
			"subCategory.items.name": 10,
			"subCategory.items.description": 4,
		},
		name: "fooditem_search_index",
	},
);

FoodItemSchema.plugin(toJSON);
module.exports = mongoose.model("FoodItem", FoodItemSchema);
