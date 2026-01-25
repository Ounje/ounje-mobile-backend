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

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication and User Management
 */

/**
 * @swagger
 * /api/auth/request-otp:
 *   post:
 *     summary: Request Email OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP generated successfully
 *       400:
 *         description: Email already in use or missing
 */
router.post("/request-otp", otpRequestLimiter, requestEmailOtp);

/**
 * @swagger
 * /api/auth/request-phone-otp:
 *   post:
 *     summary: Request Phone OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent to phone
 *       400:
 *         description: Phone already in use or missing
 */
router.post("/request-phone-otp", otpRequestLimiter, requestPhoneOtp);

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify Email OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP verified. Returns user tokens or otpSession if user not found (for registration).
 *       400:
 *         description: Invalid OTP or missing fields
 */
router.post("/verify-otp", otpVerifyLimiter, verifyEmailOtp);

/**
 * @swagger
 * /api/auth/verify-phone-otp:
 *   post:
 *     summary: Verify Phone OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - otp
 *               - reference
 *             properties:
 *               phone:
 *                 type: string
 *               otp:
 *                 type: string
 *               reference:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP verified. Returns user tokens or otpSession.
 *       400:
 *         description: Invalid verification session or OTP
 */
router.post("/verify-phone-otp", otpVerifyLimiter, verifyPhoneOtp);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User Login
 *     description: Login with email or phone. Sends OTP for verification.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or Phone number
 *     responses:
 *       200:
 *         description: OTP sent to email or phone
 *       400:
 *         description: Invalid credentials or missing fields
 */
router.post("/login", loginLimiter, login);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: User Registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - role
 *               - location
 *               - otpSession
 *             properties:
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [customer, vendor, rider]
 *               location:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               otpSession:
 *                 type: string
 *                 description: JWT token received from verify-otp
 *               operatingArea:
 *                 type: string
 *                 description: Required if role is rider
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Missing required fields or user already exists
 */
router.post("/register", registerLimiter, register);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", logOut);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh Access Token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access token generated
 *       401:
 *         description: Refresh token required or user not found
 *       403:
 *         description: Invalid refresh token
 */
router.post("/refresh", refresh);

module.exports = router;
