const User = require("./User");
const mongoose = require("mongoose");

const Vendor = User.discriminator("vendor", new mongoose.Schema({
  img: {
    data: Buffer,          
    contentType: String,  
  },
  totalRating: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
}));

module.exports = Vendor;
