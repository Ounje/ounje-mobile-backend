const mongoose = require("mongoose");

const ratingSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
});

ratingSchema.index({ vendor: 1, customer: 1 }, { unique: true });


const Rating = mongoose.model("Rating", ratingSchema);

module.exports = Rating;