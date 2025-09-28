const mongoose = require("mongoose");

const foodItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    category: String,
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" , required: true },
    price: { type: Number, required: true },
    image: String,
    isActive: { type: Boolean, default: true },
}, { timestamps: true });