const express = require("express");
const {
	getCustomerProfile,
	requestProfileChange,
	verifyProfileChangeOtp,
	updateCustomerProfile,
	deleteCustomerProfile,
	updateCustomerProfileImage,
	getCustomerWallet,
} = require("../controllers/customerController");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { userUpload } = require("../config/cloudinary");
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Customers
 *   description: Customer Profile Management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Customer:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Customer ID
 *         name:
 *           type: string
 *           description: Customer name
 *         email:
 *           type: string
 *           format: email
 *           description: Customer email
 *         phone:
 *           type: string
 *           description: Customer phone number
 *         address:
 *           type: string
 *           description: Customer address
 *         location:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               enum: [Point]
 *             coordinates:
 *               type: array
 *               items:
 *                 type: number
 *               description: [longitude, latitude]
 *         role:
 *           type: string
 *           enum: [customer]
 *         accountStatus:
 *           type: string
 *           enum: [active, suspended, deactivated]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     CustomerUpdateRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Customer name
 *         email:
 *           type: string
 *           format: email
 *           description: Customer email
 *         phone:
 *           type: string
 *           description: Customer phone number
 *         location:
 *           type: string
 *           description: Customer address (will be geocoded)
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/customers/profile:
 *   get:
 *     summary: Get logged-in customer profile
 *     description: Retrieve the profile information of the currently authenticated customer
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Customer'
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Unauthorized
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Customer not found
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.get("/profile", authMiddleware, getCustomerProfile);

/**
 * @swagger
 * /api/customers/profile/request-change:
 *   post:
 *     summary: Request email or phone change
 *     description: Initiates a sensitive profile field change. Changing email sends an OTP to the registered phone number. Changing phone sends an OTP to the registered email. Only one field can be requested at a time.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: New email address (provide this OR phone, not both)
 *               phone:
 *                 type: string
 *                 description: New phone number (provide this OR email, not both)
 *           examples:
 *             requestEmailChange:
 *               summary: Request email change
 *               value:
 *                 email: newemail@example.com
 *             requestPhoneChange:
 *               summary: Request phone change
 *               value:
 *                 phone: "08012345678"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: OTP sent to your registered phone number
 *       400:
 *         description: Bad request - both fields provided, no fields provided, or no existing contact on record
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error
 */
router.post("/profile/request-change", authMiddleware, requestProfileChange);

/**
 * @swagger
 * /api/customers/profile/verify-change:
 *   post:
 *     summary: Verify OTP for email or phone change
 *     description: Verifies the OTP sent during a profile change request. Must specify which field is being verified. On success, marks the change as approved for the next update call.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - otp
 *             properties:
 *               otp:
 *                 type: string
 *                 description: The OTP received via SMS or email
 *                 example: "4821"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The new email being verified (provide this OR phone, not both)
 *               phone:
 *                 type: number
 *                 description: The new phone being verified (provide this OR email, not both)
 *           examples:
 *             verifyEmailChange:
 *               summary: Verify email change OTP
 *               value:
 *                 otp: "4821"
 *                 email: newemail@example.com
 *             verifyPhoneChange:
 *               summary: Verify phone change OTP
 *               value:
 *                 otp: "4821"
 *                 phone: "08012345678"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: OTP verified. You may now update your profile.
 *       400:
 *         description: Invalid OTP, expired OTP, or no pending change request found
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error
 */
router.post("/profile/verify-change", authMiddleware, verifyProfileChangeOtp);

/**
 * @swagger
 * /api/customers/profile:
 *   put:
 *     summary: Update customer profile
 *     description: Update the profile information of the currently authenticated customer. All fields are optional. Email and phone changes require prior OTP verification via /profile/request-change and /profile/verify-change.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CustomerUpdateRequest'
 *           examples:
 *             updateName:
 *               summary: Update only name
 *               value:
 *                 firstName: John
 *                 lastName: Doe
 *             updateEmail:
 *               summary: Update email (requires prior OTP verification)
 *               value:
 *                 email: john.doe@example.com
 *             updatePhone:
 *               summary: Update phone (requires prior OTP verification)
 *               value:
 *                 phone: "08012345678"
 *             updateLocation:
 *               summary: Update only location
 *               value:
 *                 location: 123 Main St, Lagos, Nigeria
 *             updateAll:
 *               summary: Update all fields
 *               value:
 *                 firstName: John
 *                 lastName: Doe
 *                 email: john.doe@example.com
 *                 phone: "08012345678"
 *                 location: 123 Main St, Lagos, Nigeria
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Profile updated successfully
 *                 customer:
 *                   $ref: '#/components/schemas/Customer'
 *       400:
 *         description: Bad request - Invalid address
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: OTP verification required for email or phone change
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Email or phone changes require OTP verification first.
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error
 */
router.put("/profile", authMiddleware, updateCustomerProfile);

/**
 * @swagger
 * /api/customers/profile:
 *   delete:
 *     summary: Deactivate customer account
 *     description: Soft delete the customer account by setting accountStatus to 'deactivated'. This does not permanently delete the account.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account deactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Account deactivated successfully
 *                 customer:
 *                   $ref: '#/components/schemas/Customer'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error
 */
router.delete("/profile", authMiddleware, deleteCustomerProfile);

/**
 * @swagger
 * /api/customers/profile/picture:
 *   post:
 *     summary: Upload customer profile picture
 *     description: Upload a profile picture for the authenticated customer. Accepts multipart/form-data.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - profilePicture
 *             properties:
 *               profilePicture:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile picture uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 profilePic:
 *                   type: string
 *                   example: https://res.cloudinary.com/...
 *       400:
 *         description: No file provided
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post(
	"/profile/picture",
	authMiddleware,
	roleGuard(["customer"]),
	userUpload.single("profilePicture"),
	updateCustomerProfileImage,
);

/**
 * @swagger
 * /api/customers/wallet:
 *   get:
 *     summary: Get customer wallet balance and transactions
 *     description: Retrieve the wallet balance, pending balance, transaction history, and assigned bank account details (Titan/Paystack DVA) for the authenticated customer.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 balance:
 *                   type: number
 *                   example: 1500
 *                 pendingBalance:
 *                   type: number
 *                   example: 300
 *                 bankDetails:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     accountNumber:
 *                       type: string
 *                       example: "9012345678"
 *                     accountName:
 *                       type: string
 *                       example: "YourApp/John Doe"
 *                     bankName:
 *                       type: string
 *                       example: "Titan Paystack"
 *                     bankSlug:
 *                       type: string
 *                       example: "titan-paystack"
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       amount:
 *                         type: number
 *                         example: 500
 *                       entryType:
 *                         type: string
 *                         enum: [CREDIT, DEBIT]
 *                       reason:
 *                         type: string
 *                         example: ORDER_EARNING
 *                       balanceAfter:
 *                         type: number
 *                         example: 1500
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error
 */
router.get(
	"/wallet",
	authMiddleware,
	roleGuard(["customer"]),
	getCustomerWallet,
);

module.exports = router;
