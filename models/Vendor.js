const User = require("./User");
const mongoose = require("mongoose");

const ledgerSchema = new mongoose.Schema({
	type: { type: String, enum: ["credit", "debit"], required: true },
	amount: { type: Number, required: true },
	meta: { type: Object, default: {} },
	createdAt: { type: Date, default: Date.now },
});

const storeDetailsSchema = new mongoose.Schema(
	{
		storeName: { type: String, required: true },
		storeType: {
			type: String,
			required: true,
			enum: ["physicalStore", "onlineStore"],
		},
		CACNumber: String,
		isVerifiedBusiness: Boolean,
		status: {
			type: String,
			enum: ["active", "suspended", "pending"],
			default: "active",
		},
		needsCACSupport: {
			type: Boolean,
			default: false,
		},
		servicesOffered: {
			type: String,
			required: true,
			enum: ["InstantMeals", "preOrderMeals", "hybridMeals"],
		},
		ninID: {
			type: String,
			required: true,
		},

		timePeriod: [
			{
				day: {
					type: String,
					enum: [
						"sunday",
						"monday",
						"tuesday",
						"wednesday",
						"thursday",
						"friday",
						"saturday",
					],
				},
				closingHour: String,
				openingHour: String,
			},
		],

		preorderPeriods: [
			{
				orderingTime: String,
				preparationTime: String,
				period: { type: String, enum: ["breakfast", "lunch", "dinner"] },
			},
		],
	},
	{ timestamps: true },
);

const VendorSchema = new mongoose.Schema({
	storeDetails: [storeDetailsSchema],
	img: String,
	description: String,
	ratingCount: { type: Number, default: 0 },
	averageRating: { type: Number, default: 0 },
	totalOrders: { type: Number, default: 0 },
	likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "customer" }],
	minPrice: Number,
	balance: Number,
	ledger: [ledgerSchema],
	isAvailable: { type: Boolean, default: true },
	minDeliveryFee: Number,
	location: {
		type: { type: String, default: "Point" },
		coordinates: { type: [Number], index: "2dsphere" },
	},
	bankDetails: {
		accountNumber: String,
		bankCode: String,
		accountName: String,
	},
	paystackRecipientCode: String,
});

VendorSchema.virtual("menu", {
	ref: "Combo",
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

VendorSchema.index({ location: "2dsphere" });

const Vendor = User.discriminator("vendor", VendorSchema);
module.exports = Vendor;
