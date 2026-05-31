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
	checkUserExist,
	updateFcmToken,
	checkPhone,
	oauthSignin,
} = require("../controllers/authController");

const { authMiddleware } = require("../middleware/auth");

const {
	otpRequestLimiter,
	otpVerifyLimiter,
	loginLimiter,
	registerLimiter,
} = require("../utils/rateLimiter");

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication & OTP-based User Management
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
 *             required: [email, role, flow]
 *             properties:
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               role:
 *                 type: string
 *                 enum: [customer, vendor, rider]
 *               flow:
 *                 type: string
 *                 enum: [signup, login]
 *     responses:
 *       200:
 *         description: OTP sent to email
 *       400:
 *         description: Email already registered or invalid role/flow
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
 *             required: [phone, role, flow]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *               role:
 *                 type: string
 *                 enum: [customer, vendor, rider]
 *               flow:
 *                 type: string
 *                 enum: [signup, login]
 *     responses:
 *       200:
 *         description: OTP sent to phone
 *       404:
 *         description: User not found (login flow)
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
 *             required: [email, otp, role, flow]
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *                 example: "1234"
 *               role:
 *                 type: string
 *                 enum: [customer, vendor, rider]
 *               flow:
 *                 type: string
 *                 enum: [signup, login]
 *               fcmToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returns otpSession (signup) or auth tokens (login)
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
 *             required: [phone, otp, reference, role, flow]
 *             properties:
 *               phone:
 *                 type: string
 *               otp:
 *                 type: string
 *               reference:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [customer, vendor, rider]
 *               flow:
 *                 type: string
 *                 enum: [signup, login]
 *               fcmToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returns otpSession (signup) or auth tokens (login)
 *       400:
 *         description: Invalid OTP or session
 */
router.post("/verify-phone-otp", otpVerifyLimiter, verifyPhoneOtp);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login (Email or Phone)
 *     description: Sends OTP to email or phone for verification
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier]
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email address or phone number
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Invalid credentials
 */
router.post("/login", loginLimiter, login);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Complete Registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, role, location, otpSession]
 *             properties:
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [customer, vendor, rider]
 *               location:
 *                 type: string
 *                 example: "Lekki Phase 1, Lagos"
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               otpSession:
 *                 type: string
 *                 description: JWT returned from OTP verification
 *               fcmToken:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 */
router.post("/register", registerLimiter, register);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout User
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
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access token generated
 *       403:
 *         description: Invalid refresh token
 */
router.post("/refresh", refresh);

/**
 * @swagger
 * /api/auth/check-user:
 *   post:
 *     summary: Check if a user exists
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Existence check result
 */
router.post("/check-user", checkUserExist);
router.post("/check-phone", checkPhone);

/**
 * @swagger
 * /api/auth/fcm-token:
 *   put:
 *     summary: Update FCM Token
 *     description: Update the Firebase Cloud Messaging token for the logged in user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fcmToken]
 *             properties:
 *               fcmToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device token saved!
 *       400:
 *         description: FCM token is required
 *       401:
 *         description: Unauthorized
 */
router.put("/fcm-token", authMiddleware, updateFcmToken);

/**
 * @swagger
 * /api/auth/oauth-signin:
 *   post:
 *     summary: Sign in using OAuth (Google/Apple)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken, provider, role]
 *             properties:
 *               idToken:
 *                 type: string
 *               provider:
 *                 type: string
 *                 enum: [google, apple]
 *               role:
 *                 type: string
 *                 enum: [customer, vendor, rider]
 *               fcmToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful or needs registration
 */
router.post("/oauth-signin", oauthSignin);

module.exports = router;
