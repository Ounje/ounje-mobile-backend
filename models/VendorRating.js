const mongoose = require("mongoose");

const vendorRatingSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
});

vendorRatingSchema.index({ vendor: 1, customer: 1 }, { unique: true });


const Rating = mongoose.model("VendorRating", vendorRatingSchema);

module.exports = Rating;