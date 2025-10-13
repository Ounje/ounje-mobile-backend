// models/Option.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const OptionItemSchema = new Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String },
});


module.exports = mongoose.model("OptionItem", OptionItemSchema); 
