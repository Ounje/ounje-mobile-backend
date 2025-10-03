const express = require("express");
const { register, login, requestOtp, verifyOtp } = require("../controllers/authController");
const router = express.Router();


// Register (customer/seller/rider)
router.post("/register", register);

// Login
router.post("/login", login);

// Request OTP
router.post("/request-otp", requestOtp)

// Verify OTP
router.post("/verify-otp", verifyOtp) 


module.exports = router;
