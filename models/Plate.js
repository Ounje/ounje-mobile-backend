const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const plateSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		description: { type: String },
		customer: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Customer",
			required: true,
		},
		vendor: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "VendorProfile",
			required: true,
		},
		price: { type: Number, required: true },
		img: String,
		ordersCount: { type: Number, default: 0 },
		rating: { type: Number, default: 0 },
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		timeToMake: { type: String, required: true },
		likes: { type: Number, default: 0 },
		commentsCount: { type: Number, default: 0 },
		comments: String,
		// Flat array of subCategory.items._id values
		items: [{ type: mongoose.Schema.Types.ObjectId }],
		combos: [{ type: mongoose.Schema.Types.ObjectId, ref: "Combo" }],
	},
	{ timestamps: true },
);

plateSchema.index(
	{ name: "text", description: "text" },
	{ weights: { name: 10, description: 5 }, name: "plate_search_index" },
);

plateSchema.virtual("itemType").get(function () {
	return "Plate";
});

plateSchema.plugin(toJSON);
plateSchema.set("toJSON", { virtuals: true });
plateSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Plate", plateSchema);
