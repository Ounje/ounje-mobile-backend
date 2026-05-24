const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const riderProfileSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		riderId: {
			type: String,
			unique: true,
			sparse: true, 
			index: true,
		},
		status: {
			type: String,
			enum: ["pending", "deactivated", "available", "busy", "offline"],
			default: "pending",
		},
		operatingArea: [],
		lastZoneChange: { type: Date, default: null },
		isActive: { type: Boolean, default: false },
		setupComplete: { type: Boolean, default: false },
		currentLocation: {
			type: { type: String, enum: ["Point"], default: "Point" },
			coordinates: { type: [Number], default: [0, 0] },
		},
		modeOfDelivery: {
			type: String,
			enum: ["Bicycle", "Motorcycle"],
		},
		earnings: {
			today: { type: Number, default: 0 },
			week: { type: Number, default: 0 },
			total: { type: Number, default: 0 },
		},
		ratings: {
			average: { type: Number, default: 0 },
			count: { type: Number, default: 0 },
		},
		totalDeliveries: { type: Number, default: 0 },
		rank: { type: String, default: "New Rider" },
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		rankingScore: { type: Number, default: 0 },
		tier: { type: String, enum: ["STARTER", "ACTIVE", "PRO", "ELITE"], default: "STARTER" },
		acceptanceRate: { type: Number, default: 100 },
		ordersOffered: { type: Number, default: 0 },
		ordersAccepted: { type: Number, default: 0 },
		guarantor: {
			name: { type: String },
			phone: { type: String },
			nin: { type: String },
		},
		bankDetails: {
			accountName: String,
			accountNumber: String,
			bankName: String,
			bankCode: String,
			status: {
				type: String,
				enum: ["pending", "approved", "rejected"],
				default: "pending",
			},
		},
		paystackRecipientCode: { type: String },
		profilePicture: String,
		driversLicense: String,
		nin: String,
		fcmToken: { type: String, default: null },
		notificationPreferences: {
			newRequests: { type: Boolean, default: true },
			earnings: { type: Boolean, default: true },
			promotions: { type: Boolean, default: true },
		},
	},
	{ timestamps: true },
);

riderProfileSchema.plugin(toJSON);
riderProfileSchema.index({ currentLocation: "2dsphere" });

module.exports = mongoose.model("RiderProfile", riderProfileSchema);