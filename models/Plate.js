const mongoose = require("mongoose");
require("./FoodCategory");

const plateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "customer" , required: true },
  price: { type: Number, required: true },
  img: String,
  ordersCount: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  timeToMake: {type: String, required: true},
  likes: { type: Number, default: 0},
  items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' }],
}, { timestamps: true });

module.exports =mongoose.model("Plate", plateSchema);
