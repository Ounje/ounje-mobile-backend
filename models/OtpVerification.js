const mongoose = require("mongoose");
const otpVerificationSchema = new mongoose.Schema({
  email: { type: String, required: false },
  phone: { type: String, trim: true, index: false }, // <-- NEW
  otp: { type: String, required: false },
  reference: { type: String }, // <-- NEW (Used for KudiSMS Verification)
  isPhone: { type: Boolean, default: false }, // <-- NEW flag
  createdAt: { type: Date, default: Date.now, expires: 600 } // OTP expires in 10 minutes
});

// Ensure a record must have either an email or a phone
otpVerificationSchema.pre('save', function(next) {
    if (!this.email && !this.phone) {
        return next(new Error('Verification record must have an email or a phone number.'));
    }
    next();
});

module.exports = mongoose.model("OtpVerification", otpVerificationSchema);