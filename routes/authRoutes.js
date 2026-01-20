// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const {
	register,
	login,
	requestEmailOtp,
	verifyEmailOtp,
	requestPhoneOtp,
	verifyPhoneOtp,
	logOut,
	refresh,
} = require("../controllers/authController");

const {
	otpRequestLimiter,
	otpVerifyLimiter,
	loginLimiter,
	registerLimiter,
} = require("../utilis/rateLimiter");

router.post("/request-otp", otpRequestLimiter, requestEmailOtp);
router.post("/request-phone-otp", otpRequestLimiter, requestPhoneOtp);

router.post("/verify-otp", otpVerifyLimiter, verifyEmailOtp);
router.post("/verify-phone-otp", otpVerifyLimiter, verifyPhoneOtp);

router.post("/login", loginLimiter, login);

router.post("/register", registerLimiter, register);

router.post("/logout", logOut);
router.post("/refresh", refresh);

module.exports = router;
