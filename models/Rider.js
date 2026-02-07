const User = require("./User");
const mongoose = require("mongoose");

const GuarantorSchema = new mongoose.Schema({
	guarantorName: {
		type: String,
		required: true,
	},

	guarantorPhone: {
		type: String,
		required: true,
	},
	guarantorNin: {
		type: String,
		required: true,
	},
});
const Rider = User.discriminator(
	"rider",
	new mongoose.Schema({
		isAvailable: { type: Boolean, default: true },
		operatingArea: [String],
		modeOfDelivery: { type: String, enum: ["Bicycle", "Motorcycle"] },
		// Rating & Likes
		ratingCount: { type: Number, default: 0 },
		averageRating: { type: Number, default: 0 },
		likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "customer" }],
		driversLicense: String,
		nin: String,
		status: {
			type: String,
			enum: ["pending", "deactivated", "active", "suspended"],
			default: "pending",
		},
		Guarantor: [GuarantorSchema],
		// Geospatial searches
		lastKnownLocation: {
			type: { type: String, default: "Point" },
			coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
		},

		// Bank and payout recipient info
		bankDetails: {
			accountNumber: String,
			bankCode: String,
			accountName: String,
		},
		paystackRecipientCode: String,
	}),
);

// Creates the index so MongoDB can search by distance
Rider.schema.index({ lastKnownLocation: "2dsphere" });

module.exports = Rider;
