const mongoose = require("mongoose");
const Plate = require("./Plate");
const FoodItem = require("./FoodItem");
const Dish = require("./Dish");


const orderSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "customer",
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vendor",
    required: true
  },
  items: [
    {
      itemType: {
        type: String,
        enum: ["FoodItem", "Dish", "Plate"],
        required: true
      },
      item: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: "items.itemType" // <-- Dynamic reference
      },
      quantity: {
        type: Number,
        default: 1,
        min: 1
      },
      price: {
        type: Number,
        required: true
      },
      notes: String // optional instructions
    }
  ],
  totalPrice: {
    type: Number,
    required: true
  },
  // foodTotal: {
  //   type: Number,
  //   required: true
  // },
  // deliveryFee: {
  //   type: Number,
  //   required: true
  // },
  status: {
    type: String,
    enum: ["pending", "accepted", "in_progress", "completed", "cancelled"],
    default: "pending"
  },
  deliveryAddress: {
    type: String
  },
  paymentStatus: {
    type: String,
    enum: ["unpaid", "paid", "refunded"],
    default: "unpaid"
  },
  createdAt: {
    type: Date,
    default: Date.now()
  }
});


module.exports = mongoose.model("Order", orderSchema);
