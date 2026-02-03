const express = require("express");
const { getCustomerProfile } = require("../controllers/customerController");
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
 * /api/customers/profile:
 *   get:
 *     summary: Get logged-in customer profile
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer profile
 *       404:
 *         description: Customer not found
 */
router.get("/profile", authMiddleware,  getCustomerProfile);

module.exports = router;
