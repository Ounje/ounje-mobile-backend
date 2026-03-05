const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const riderProfileSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		status: {
			type: String,
			enum: ["pending", "deactivated", "available", "busy", "offline"],
			default: "pending",
		},
		operatingArea: [],
		isActive: { type: Boolean, default: false },
		setupComplete: { type: Boolean, default: false },
		currentLocation: {
			type: { type: String, enum: ["Point"], default: "Point" },
			coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
		},
		// vehicle: {
		// 	type: { type: String, enum: ["Bicycle", "Motorcycle", "Car", "Van"] },
		// 	plateNumber: String,
		// 	model: String,
		// 	color: String,
		// },
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
		totalDeliveries: {
			type: Number,
			default: 0,
		},
		rank: {
			type: String,
			default: "New Rider",
		},
		averageRating: { type: Number, default: 0 },
		ratingCount: { type: Number, default: 0 },
		// Personal Verification Documents
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
		profilePicture: String, // Cloudinary URL
		driversLicense: String, // URL or ID
		nin: String, // National Identity Number
		fcmToken: { type: String, default: null }, // Expo push token for notifications
		notificationPreferences: {
			newRequests: { type: Boolean, default: true },
			earnings: { type: Boolean, default: true },
			promotions: { type: Boolean, default: true },
		},
	},
	{
		timestamps: true,
	},
);

riderProfileSchema.plugin(toJSON);

module.exports = mongoose.model("RiderProfile", riderProfileSchema);
