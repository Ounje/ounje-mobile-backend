const express = require("express");
const { register, login, requestOtp, verifyOtp, logOut, refresh } = require("../controllers/authController");
const router = express.Router();


// Register (customer/seller/rider)
router.post("/register", register);

// Login
router.post("/login", login);

// Request OTP
router.post("/request-otp", requestOtp)

// Verify OTP
router.post("/verify-otp", verifyOtp) 

//Refresh token should be included in the body
router.post("/logout", logOut);

//The accessToken should be included in the body
router.post("/refresh", refresh);


module.exports = router;
