const mongoose = require("mongoose");
// const {
// 	getCategoryValues,
// 	getSubCategoryValues,
// } = require("../utilis/foodEnums");

// Schema for individual items within a selection
const SelectionItemSchema = new mongoose.Schema({
	name: { type: String, required: true },
	price: {
		type: Number,
		required: true,
		min: [0.01, "Price must be greater than zero"],
	},
	isAvailable: { type: Boolean, default: true },
});

// Schema for selection groups (e.g., base, sides, extras)
const SelectionGroupSchema = new mongoose.Schema({
	category: { type: String, required: true }, // e.g., "rice", "protein", "extras"
	label: { type: String, required: true }, // e.g., "Rice Selection", "Protein Selection"
	required: { type: Boolean, default: false },
	items: [SelectionItemSchema],
});

const ComboSchema = new mongoose.Schema(
	{
		comboName: { type: String, required: true },
		description: { type: String },
		basePrice: { type: Number, required: true }, // Base price of the combo
		selections: {
			type: Map,
			of: SelectionGroupSchema,
		}, // Dynamic keys like "base", "sides", "extras"
		vendor: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "vendor",
			required: true,
		},
		img: { type: String, required: true },
		time: { type: String, required: true }, // Preparation time
		deliveryTime: { type: String },
		ordersCount: { type: Number, default: 0 },
		//isAvailable: { type: Boolean, default: true },
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "customer" }],
	},
	{ timestamps: true },
);

ComboSchema.set("toJSON", { virtuals: true });
ComboSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Combo", ComboSchema);
