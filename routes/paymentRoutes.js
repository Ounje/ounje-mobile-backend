const express = require("express");
const { initialisePayment, verifyPayment, webhookHandler, walletPayment } = require("../controllers/paymentController");
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

/**
 * @swagger
 * /api/payments/wallet:
 *   post:
 *     summary: Pay for an order using wallet balance
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
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 order:
 *                   type: object
 *       400:
 *         description: Insufficient wallet balance or order already paid
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Order or customer not found
 */
router.post("/wallet", authMiddleware, roleGuard(["customer"]), walletPayment);

module.exports = router;