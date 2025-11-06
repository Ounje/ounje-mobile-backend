// models/Option.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const FoodItemSchema = new Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  img: { type: String, required: true },
  description: { type: String },
  vendor: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
  category: {type: String, required: true},
  sellingUnit: { type: String, required: true  },
});


module.exports = mongoose.model("FoodItem", FoodItemSchema); 
