const mongoose = require("mongoose");
const {
	getCategoryValues,
	getSubCategoryValues,
} = require("../utilis/foodEnums");

const ComboItemSchema = new mongoose.Schema({
	foodItem: {
		type: mongoose.Schema.Types.ObjectId, // can get existing food item
		ref: "FoodItem",
	},

	//create new food item
	name: { type: String }, // Required if foodItem is null
	unitPrice: { type: Number }, // Required if foodItem is null

	// Common fields
	quantity: { type: Number, required: true, default: 1 },
	notes: { type: String }, // Additional notes about this item
});

// Validation: Either foodItem OR (name + unitPrice) must be provided
ComboItemSchema.pre("validate", function (next) {
	if (!this.foodItem && (!this.name || !this.unitPrice)) {
		return next(
			new Error(
				"Either foodItem reference OR (name + unitPrice) must be provided",
			),
		);
	}
	next();
});

const ComboSchema = new mongoose.Schema(
	{
		comboName: { type: String, required: true },
		description: { type: String }, // Text description
		items: [ComboItemSchema], // Array of items in the combo
		category: {
			type: String,
			enum: getCategoryValues(),
		},
		subCategory: {
			type: String,
			enum: getSubCategoryValues(),
		},
		vendor: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Vendor",
			required: true,
		},
		price: { type: Number }, // Auto-calculated
		img: { type: String, required: true },
		time: { type: String, required: true }, // Preparation time
		deliveryTime: { type: String },
		ordersCount: { type: Number, default: 0 },
		isActive: { type: Boolean, default: true },
		ratingAverage: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "customer" }],
	},
	{ timestamps: true },
);

// Virtual to compute total price
ComboSchema.virtual("computedPrice").get(function () {
	return (this.items || []).reduce((sum, item) => {
		if (item.foodItem && item.foodItem.price) {
			// Using existing FoodItem (must be populated)
			return sum + item.foodItem.price * item.quantity;
		} else if (item.unitPrice) {
			// Using custom item
			return sum + item.unitPrice * item.quantity;
		}
		return sum;
	}, 0);
});

// Auto-calculate price before saving
ComboSchema.pre("save", async function (next) {
	// If items have foodItem references, populate them to calculate price
	if (this.items && this.items.length > 0) {
		let totalPrice = 0;

		for (let item of this.items) {
			if (item.foodItem) {
				// fetch the FoodItem to get its price if food item is used
				const FoodItem = mongoose.model("FoodItem");
				const foodItem = await FoodItem.findById(item.foodItem);
				if (foodItem) {
					totalPrice += foodItem.price * item.quantity;
				}
			} else if (item.unitPrice) {
				totalPrice += item.unitPrice * item.quantity;
			}
		}

		this.price = totalPrice;
	}
	next();
});

ComboSchema.set("toJSON", { virtuals: true });
ComboSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Combo", ComboSchema);
