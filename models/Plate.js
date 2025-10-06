const mongoose = require("mongoose");
const { Schema } = mongoose;
const OptionCategorySchema = require("./Option");

const PlateDetailsSchema = new Schema({
  category: { type: String },
  closeTime: { type: String },
  rating: { type: Number, default: 0 },
  minPrice: { type: Number },
  deliveryTime: { type: String },
  options: [OptionCategorySchema],
});

const PlateSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  items: { type: String },
  time: { type: String },
  likes: { type: Number, default: 0 },
  price: { type: Number, required: true },
  image: { type: String },
  details: PlateDetailsSchema,
});

module.exports = PlateSchema;
