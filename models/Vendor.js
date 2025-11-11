const User = require("./User");
const mongoose = require("mongoose");

const VendorSchema = new mongoose.Schema({
  img: String,
  description: String,
  totalRating: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  minPrice: Number,
  closeTime: String,
  isAvailable: { type: Boolean, default: true },
  minDeliveryFee: Number,
  closingTime: String,
});



VendorSchema.virtual("menu", {
  ref: "Dish",            
  localField: "_id",      
  foreignField: "vendor", 
});

VendorSchema.virtual("foodItems", {
  ref: "FoodItem",        
  localField: "_id",      
  foreignField: "vendor", 
});

VendorSchema.set("toObject", { virtuals: true });
VendorSchema.set("toJSON", { virtuals: true });


const Vendor = User.discriminator("vendor", VendorSchema );
module.exports = Vendor;
