const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const riderProfileSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        status: {
            type: String,
            enum: ["pending", "deactivated", "available", "busy", "offline"],
            default: "pending",
        },
        currentLocation: {
            type: { type: String, enum: ["Point"], default: "Point" },
            coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
        },
        vehicle: {
            type: { type: String, enum: ["Bicycle", "Motorcycle", "Car", "Van"] },
            plateNumber: String,
            model: String,
            color: String,
        },
        earnings: {
            today: { type: Number, default: 0 },
            week: { type: Number, default: 0 },
            total: { type: Number, default: 0 },
        },
        ratings: {
            average: { type: Number, default: 0 },
            count: { type: Number, default: 0 },
        },
        averageRating: { type: Number, default: 0 },
        ratingCount: { type: Number, default: 0 },
        // Personal Verification Documents
        guarantor: {
            name: { type: String },
            phone: { type: String },
            nin: { type: String },
        },
        driversLicense: String, // URL or ID
        nin: String, // National Identity Number
    },
    {
        timestamps: true,
    },
);

riderProfileSchema.index({ currentLocation: "2dsphere" });
riderProfileSchema.plugin(toJSON);

module.exports = mongoose.model("RiderProfile", riderProfileSchema);
