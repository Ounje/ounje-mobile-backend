const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const customerSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		firstName: { type: String },
		lastName: { type: String },
		phone: { type: String },
		isActive: { type: Boolean, default: true },
		savedAddresses: [
			{
				label: { type: String, required: true }, // e.g., "Home", "Work"
				address: { type: String, required: true },
				coordinates: { type: [Number], index: "2dsphere" }, // [longitude, latitude]
				details: String, // Apt number, instructions
			},
		],
		preferences: {
			marketingEmails: { type: Boolean, default: true },
			pushNotifications: { type: Boolean, default: true },
		},
	},
	{ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

customerSchema.virtual("orderCount", {
    ref: "Order",           // The model to count from
    localField: "_id",      // The ID of the Customer
    foreignField: "customer", // The field in the Order model that stores the Customer ID
    count: true,            // Return just the number
});

customerSchema.plugin(toJSON);

module.exports = mongoose.model("Customer", customerSchema);
