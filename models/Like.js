const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const likeSchema = new mongoose.Schema(
    {
        targetType: {
            type: String,
            enum: ["FoodItem", "Combo", "Vendor", "Rider", "Plate"],
            required: true,
        },
        target: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            refPath: "targetType", // Dynamic reference based on targetType, though mapping might be complex if targetType string != model name
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true,
        },
    },
    { timestamps: true },
);

// Ensure a user can only like a target once
likeSchema.index({ targetType: 1, target: 1, customer: 1 }, { unique: true });

likeSchema.plugin(toJSON);

module.exports = mongoose.model("Like", likeSchema);
