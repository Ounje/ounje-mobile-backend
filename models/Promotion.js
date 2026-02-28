const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const promotionSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, unique: true, uppercase: true },
        description: String,
        type: {
            type: String,
            enum: ["percentage", "fixed_amount"],
            required: true,
        },
        value: { type: Number, required: true }, // Percentage (0-100) or Amount
        maxDiscount: Number, // Cap for percentage
        minOrderValue: { type: Number, default: 0 },
        usageLimit: Number,
        usedCount: { type: Number, default: 0 },
        startsAt: Date,
        expiresAt: Date,
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
);

promotionSchema.plugin(toJSON);

module.exports = mongoose.model("Promotion", promotionSchema);
