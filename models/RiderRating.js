const mongoose = require("mongoose");

const riderRatingSchema = new mongoose.Schema({
  rider: { type: mongoose.Schema.Types.ObjectId, ref: "rider", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
});

riderRatingSchema.index({ vendor: 1, customer: 1 }, { unique: true });


const Rating = mongoose.model("RiderRating", ratingSchema);

module.exports = Rating;