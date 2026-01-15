const User = require("./User");
const mongoose = require("mongoose");

const ledgerSchema = new mongoose.Schema({
	type: { type: String, enum: ["credit", "debit"], required: true },
	amount: { type: Number, required: true },
	meta: { type: Object, default: {} },
	createdAt: { type: Date, default: Date.now },
});

const storeDetails = new mongoose.Schema({
	storeName: { type: String, required: true },
	storeType: {
		type: String,
		required: true,
		enum: ["physicalStore", "onlineStore"],
	},
	CACNumber: String,
	isVerifiedBusiness: Boolean,
	servicesOffered: {
		type: String,
		required: true,
		enum: ["InstantMeals", "preOrderMeals", "hybridMeals"],
	},
	ninID: {
		type: String,
		required: true,
	},
});

const VendorSchema = new mongoose.Schema({
	storeDetails: [storeDetails],
	img: String,
	description: String,
	totalRating: { type: Number, default: 0 },
	averageRating: { type: Number, default: 0 },
	totalOrders: { type: Number, default: 0 },
	minPrice: Number,
	closeTime: String,
	balance: Number,
	ledger: [ledgerSchema],
	isAvailable: { type: Boolean, default: true },
	minDeliveryFee: Number,
	closingTime: String,

	// Bank and payout recipient info
	bankDetails: {
		accountNumber: String,
		bankCode: String,
		accountName: String,
	},
	paystackRecipientCode: String,
});

VendorSchema.virtual("menu", {
	ref: "Dish",
	localField: "_id",
	foreignField: "vendor",
});

VendorSchema.virtual("foodItems", {
	ref: "FoodItem",
	localField: "_id",
	foreignField: "vendor",
});

VendorSchema.set("toObject", { virtuals: true });
VendorSchema.set("toJSON", { virtuals: true });

// This tells MongoDB to allow "distance" math on the location field
VendorSchema.index({ location: "2dsphere" });

const Vendor = User.discriminator("vendor", VendorSchema);
module.exports = Vendor;
