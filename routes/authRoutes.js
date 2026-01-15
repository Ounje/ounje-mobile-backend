// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const {
	register,
	login,
	requestOtp,
	verifyOtp,
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

router.post("/request-otp", otpRequestLimiter, requestOtp);
router.post("/request-phone-otp", otpRequestLimiter, requestPhoneOtp);

router.post("/verify-otp", otpVerifyLimiter, verifyOtp);
router.post("/verify-phone-otp", otpVerifyLimiter, verifyPhoneOtp);

router.post("/login", loginLimiter, login);

router.post("/register", registerLimiter, register);

router.post("/logout", logOut);
router.post("/refresh", refresh);

module.exports = router;
