const mongoose = require('mongoose');

const riderEarningsSchema = new mongoose.Schema({   
    rider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Rider",
        required: true
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ["pending", "paid"],
        default: "pending"
    }
}, { timestamps: true });

module.exports = mongoose.model("RiderEarnings", riderEarningsSchema);