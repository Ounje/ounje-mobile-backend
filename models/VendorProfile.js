const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const storeDetailsSchema = new mongoose.Schema(
	{
		storeName: String,
		storeType: String,
		isVerifiedBusiness: Boolean,
		CACNumber: String,
		servicesOffered: String,
		ninID: String,
		status: {
			type: String,
			enum: ["pending", "deactivated", "suspended", "available", "active"],
			default: "pending",
		},
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
		isOpen: { type: Boolean, default: false },
	},
	{ _id: false },
);

const vendorProfileSchema = new mongoose.Schema(
	{
		owner: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		name: { type: String, required: true },
		description: String,
		profileImage: String,
		logoUrl: String,
		bannerUrl: String,
		rating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		averageRating: { type: Number, default: 0 },
		isActive: { type: Boolean, default: true },
		tier: {
			type: String,
			enum: ["basic", "growth", "premium"],
			default: "basic",
		},
		balance: { type: Number, default: 0 },
		earnings: {
			today: { type: Number, default: 0 },
			week: { type: Number, default: 0 },
			total: { type: Number, default: 0 },
		},
		rankingScore: { type: Number, default: 0, index: true },
		location: {
			type: { type: String, enum: ["Point"], default: "Point" },
			coordinates: { type: [Number] },
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
			deliveryPrice: { type: Number, default: 0 },
		},
		// operatingHours: [
		// 	{
		// 		day: {
		// 			type: String,
		// 			enum: [
		// 				"monday",
		// 				"tuesday",
		// 				"wednesday",
		// 				"thursday",
		// 				"friday",
		// 				"saturday",
		// 				"sunday",
		// 			],
		// 		},
		// 		open: String,
		// 		close: String,
		// 		isOpen: { type: Boolean, default: false },
		// 	},
		// ],
		bankDetails: {
			accountNumber: { type: String, select: false },
			bankCode: { type: String, select: false },
			accountName: { type: String, select: false },
		},
		storeDetails: [storeDetailsSchema],
	},
	{ timestamps: true },
);
vendorProfileSchema.index(
	{
		name: "text",
		owner: 1,
		description: "text",
		"storeDetails.storeName": "text",
		"location.address": "text",
	},
	{
		weights: {
			name: 10,
			"storeDetails.storeName": 8,
			description: 5,
			"location.address": 3,
		},
		name: "vendor_search_index",
	},
);
vendorProfileSchema.index({ location: "2dsphere" });
vendorProfileSchema.plugin(toJSON);

module.exports = mongoose.model("VendorProfile", vendorProfileSchema);
