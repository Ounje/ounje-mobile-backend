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
		timeToMake: { type: String, required: true },
		likes: { type: Number, default: 0 },
		comments: String,
		items: [{ type: mongoose.Schema.Types.ObjectId, ref: "FoodItem" }],
	},
	{ timestamps: true },
);

plateSchema.plugin(toJSON);


module.exports = mongoose.model("Plate", plateSchema);
