const express = require("express");
const {
	getCustomerProfile,
	updateCustomerProfile,
	deleteCustomerProfile,
} = require("../controllers/customerController");
const { authMiddleware } = require("../middleware/auth");
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
 *         fcmToken:
 *           type: string
 *           description: Firebase Cloud Messaging token
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
 * /api/customers/profile:
 *   put:
 *     summary: Update customer profile
 *     description: Update the profile information of the currently authenticated customer. All fields are optional - only provided fields will be updated.
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
 *                 name: John Doe
 *             updateEmail:
 *               summary: Update only email
 *               value:
 *                 email: john.doe@example.com
 *             updateLocation:
 *               summary: Update only location
 *               value:
 *                 location: 123 Main St, Lagos, Nigeria
 *             updateAll:
 *               summary: Update all fields
 *               value:
 *                 name: John Doe
 *                 email: john.doe@example.com
 *                 phone: "+2348012345678"
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid address
 *       401:
 *         description: Unauthorized - Invalid or missing token
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
 *         description: Unauthorized - Invalid or missing token
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
router.delete("/profile", authMiddleware, deleteCustomerProfile);

module.exports = router;
