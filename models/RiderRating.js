const mongoose = require("mongoose");

const riderRatingSchema = new mongoose.Schema(
	{
		rider: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "rider",
			required: true,
		},
		customer: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "customer",
			required: true,
		},
		rating: {
			type: Number,
			min: 1,
			max: 5,
			required: true,
		},
		comments: String,
	},
	{ timestamps: true },
);

// One rating per customer per rider
riderRatingSchema.index({ rider: 1, customer: 1 }, { unique: true });

const RiderRating = mongoose.model("RiderRating", riderRatingSchema);

module.exports = RiderRating;
