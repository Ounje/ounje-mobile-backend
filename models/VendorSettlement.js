const mongoose = require("mongoose");

const vendorSettlementSchema = new mongoose.Schema({
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
        required: true
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        required: true
    },
    gross: {
        type: Number,
        required: true
    },
    commission: {
        type: Number,
        required: true
    },
    netPayable: {
        type: Number,
        required: true
    },
    // settlementDate: {   
    //     type: Date,
    //     default: Date.now
    // },
    // method: {
    //     type: String,
    //     enum: ["bank_transfer", "mobile_money", "cash"],
    //     required: true
    // },
    reference: String,
    status: {
        type: String,
        enum: ["pending", "paid"],
        default: "pending"
    }
}, { timestamps: true });

module.exports = mongoose.model("VendorSettlement", vendorSettlementSchema);