const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");
// const {
// 	getCategoryValues,
// 	getSubCategoryValues,
// } = require("../utils/foodEnums");

// Schema for individual items within a selection
const SelectionItemSchema = new mongoose.Schema({
	item: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "FoodItem",
		required: true,
	},
	name: { type: String }, // Denormalized name from FoodItem for quick access
	price: {
		type: Number,
		default: 0,
		min: [0, "Price must be greater than or equal to zero"],
	},
	isAvailable: { type: Boolean, default: true },
});

// Schema for selection groups (e.g., base, sides, extras)
const SelectionGroupSchema = new mongoose.Schema({
	key: { type: String, required: true }, // e.g., "base", "sides"
	label: { type: String, required: true }, // e.g., "Rice Selection", "Protein Selection"
	required: { type: Boolean, default: false },
	maxSelection: { type: Number, default: 1 },
	items: [SelectionItemSchema],
});

const ComboSchema = new mongoose.Schema(
	{
		comboName: { type: String, required: true },
		description: { type: String },
		basePrice: { type: Number, required: true }, // Base price of the combo
		selections: [SelectionGroupSchema], // Changed from Map to Array for better population support
		comboGroup: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ComboGroup",
		},
		vendor: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "VendorProfile",
			required: true,
		},
		img: { type: String, required: true },
		time: { type: String, required: true }, // Preparation time
		deliveryTime: { type: String },
		ordersCount: { type: Number, default: 0 },
		isAvailable: { type: Boolean, default: true },
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Customer" }],
	},
	{ timestamps: true },
);

ComboSchema.index(
	{
		comboName: "text",
		description: "text",
		"selections.items.name": "text",
	},
	{
		weights: {
			comboName: 10,
			"selections.items.name": 7,
			description: 5,
		},
		name: "combo_search_index",
	},
);

ComboSchema.virtual("itemType").get(function () {
	return "Combo";
});

ComboSchema.plugin(toJSON);

ComboSchema.set("toJSON", { virtuals: true });
ComboSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Combo", ComboSchema);
