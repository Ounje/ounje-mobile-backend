const mongoose = require("mongoose");
const comboSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" , required: true },
    price: { type: Number, required: true },
    img: {
    data: Buffer,          
    contentType: String,  
    },
    isActive: { type: Boolean, default: true },
    totalRating: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model("Combo", comboSchema);