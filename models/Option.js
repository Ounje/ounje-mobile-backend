// models/Option.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const OptionItemSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String },
});

const OptionCategorySchema = new Schema({
  category: { type: String, required: true },
  items: [OptionItemSchema],
});

module.exports = OptionCategorySchema; 
