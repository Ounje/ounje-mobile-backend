const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const comboGroupSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        description: { type: String },
        vendor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "VendorProfile",
            required: true,
        },
        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active",
        },
    },
    { timestamps: true },
);

comboGroupSchema.plugin(toJSON);

module.exports = mongoose.model("ComboGroup", comboGroupSchema);
