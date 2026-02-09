const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const storeDetailsSchema = new mongoose.Schema({
	storeName: String,
	storeType: String,
	isVerifiedBusiness: Boolean,
	CACNumber: String,
	servicesOffered: String,
	ninID: String,
	status: { type: String, default: "pending" },
	needsCACSupport: Boolean,
	timePeriod: [
		{
			day: String,
			openingHour: String,
			closingHour: String,
		},
	],
	preorderPeriods: [
		{
			orderingTime: String,
			preparationTime: String,
			period: String,
		},
	],
});

const vendorProfileSchema = new mongoose.Schema(
	{
		owner: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		name: { type: String, required: true },
		// slug: { type: String, unique: true },
		description: String,
		logoUrl: String,
		bannerUrl: String,
		rating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		isActive: { type: Boolean, default: true },
		balance: { type: Number, default: 0 }, // Cached available balance from Ledger
		earnings: {
			today: { type: Number, default: 0 },
			week: { type: Number, default: 0 },
			total: { type: Number, default: 0 },
		},
		location: {
			type: { type: String, enum: ["Point"], default: "Point" },
			coordinates: { type: [Number], index: "2dsphere" },
			address: String,
		},
		fulfillmentSettings: {
			type: {
				type: String,
				enum: ["on_demand", "preorder"],
				default: "on_demand",
			},
			minLeadTimeHours: Number,
			maxDaysInAdvance: Number,
			preparationTimeMin: Number,
			autoAcceptOrders: { type: Boolean, default: false },
			minOrderAmount: { type: Number, default: 0 },
		},
		operatingHours: [
			{
				day: {
					type: String,
					enum: [
						"monday",
						"tuesday",
						"wednesday",
						"thursday",
						"friday",
						"saturday",
						"sunday",
					],
				},
				open: String, // HH:mm
				close: String, // HH:mm
				isClosed: { type: Boolean, default: false },
			},
		],
		bankDetails: {
			accountNumber: { type: String, select: false },
			bankCode: { type: String, select: false },
			accountName: { type: String, select: false },
		},
		storeDetails: [storeDetailsSchema],
	},
	{ timestamps: true },
);

vendorProfileSchema.index({ location: "2dsphere" });
vendorProfileSchema.plugin(toJSON);

module.exports = mongoose.model("VendorProfile", vendorProfileSchema);
