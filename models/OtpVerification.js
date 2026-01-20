const mongoose = require("mongoose");

const otpVerificationSchema = new mongoose.Schema({
	email: {
		type: String,
		trim: true,
		lowercase: true,
		required: function () {
			return !this.phone; // email required if phone is not present
		},
	},
	phone: {
		type: String,
		trim: true,
		required: function () {
			return !this.email; // phone required if email is not present
		},
	},
	otp: String,
	reference: {
		type: String, // used for SMS verification
	},
	isPhone: {
		type: Boolean,
		default: false,
	},
	isEmail: {
		type: Boolean,
		default: false,
	},
	createdAt: {
		type: Date,
		default: Date.now,
		expires: 600, // expires in 10 minutes
	},
});

otpVerificationSchema.pre("save", function (next) {
	if (!this.email && !this.phone) {
		return next(new Error("OTP record must have either email or phone."));
	}
	next();
});

module.exports = mongoose.model("OtpVerification", otpVerificationSchema);
