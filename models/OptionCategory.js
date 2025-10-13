const mongoose = require("mongoose");
const { Schema } = mongoose;

const OptionCategorySchema = new Schema({
  category: { type: String, required: true },
  items: [{type: Schema.Types.ObjectId, ref: 'OptionItem'}],
});

module.exports = mongoose.model("OptionCategory", OptionCategorySchema);