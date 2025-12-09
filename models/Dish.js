const mongoose = require("mongoose");

const dishItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
});

const dishSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: [dishItemSchema],
  category: String,
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "vendor" , required: true },
  price: { type: Number, required: true },
  img: String,
  ordersCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  rating: { type: Number, default: 0 },
  time: {type: String, required: true},
  likes: { type: Number, default: 0},
  deliveryTime: String,
  minPrice: { type: Number, required: true },
}, { timestamps: true });

dishSchema.virtual("computedPrice").get(function () {
  return (this.description || []).reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
});

dishSchema.pre("save", function (next) {
  this.price = this.computedPrice;
  next();
});



module.exports = mongoose.model("Dish", dishSchema);
