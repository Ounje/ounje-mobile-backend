const mongoose = require("mongoose");
const { Schema } = mongoose;
require("./FoodItem");

const FoodCategorySchema = new Schema({
  category: { type: String, required: true },
  items: [{type: Schema.Types.ObjectId, ref: 'FoodItem'}],
});

module.exports = mongoose.model("FoodCategory", FoodCategorySchema);