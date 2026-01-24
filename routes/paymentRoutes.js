const express = require("express");
const { initialisePayment, verifyPayment, webhookHandler } = require("../controllers/paymentController");
const { authMiddleware, roleGuard, ipWhitelist } = require("../middleware/auth");
const router = express.Router();



/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Payment Processing
 */

/**
 * @swagger
 * /api/payments/initiate:
 *   post:
 *     summary: Initiate a payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - email
 *             properties:
 *               amount:
 *                 type: number
 *               email:
 *                 type: string
 *               orderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment initialized
 */
router.post("/initiate", authMiddleware, roleGuard(["customer"]), initialisePayment)

/**
 * @swagger
 * /api/payments/verify:
 *   get:
 *     summary: Verify a payment
 *     tags: [Payments]
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment verified
 */
router.get("/verify", verifyPayment); 

/**
 * @swagger
 * /api/payments/webhook:
 *   post:
 *     summary: Payment webhook
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Webhook received
 */
router.post("/webhook", webhookHandler); 

module.exports = router;