const express = require("express");
const router = express.Router();
const { webhookHandler } = require("../controllers/paymentController");

/**
 * @swagger
 * tags:
 *   name: Webhooks
 *   description: External Webhooks
 */

/**
 * @swagger
 * /api/webhooks/paystack:
 *   post:
 *     summary: Paystack Webhook
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: OK
 */
router.post(
	"/paystack",
	express.raw({ type: "application/json" }),
	webhookHandler,
);

module.exports = router;
