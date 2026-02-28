const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const otpSchema = new mongoose.Schema(
    {
        identifier: { type: String, required: true, index: true }, // Phone or Email
        codeHash: { type: String, required: true },
        purpose: {
            type: String,
            enum: ["login", "verify_phone", "verify_email", "reset_password"],
            default: "login",
        },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true },
);

// TTL Index: Auto-delete 5 minutes after expiresAt (or at expiresAt if expireAfterSeconds is 0)
// Using 0 so it expires exactly when expiresAt passes.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

otpSchema.plugin(toJSON);

module.exports = mongoose.model("OTP", otpSchema);
