const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const announcementSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        message: { type: String, required: true },
        imageUrl: String,
        targetRoles: {
            type: [String],
            enum: ["customer", "rider", "vendor", "all"],
            default: ["all"],
        },
        isActive: { type: Boolean, default: true },
        expiresAt: Date,
    },
    { timestamps: true },
);

announcementSchema.plugin(toJSON);

module.exports = mongoose.model("Announcement", announcementSchema);
