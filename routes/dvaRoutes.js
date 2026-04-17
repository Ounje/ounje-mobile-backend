// routes/dvaRoutes.js

const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const { getOrCreateDVA, provisionDVA } = require("../controllers/dvaController");

/**
 * @swagger
 * tags:
 *   name: Virtual Account
 *   description: Paystack-Titan Dedicated Virtual Accounts
 */

/**
 * @swagger
 * /api/dva/account:
 *   get:
 *     summary: Get (or auto-create) the customer's Titan virtual account
 *     description: >
 *       Returns the customer's permanent Titan bank account number.
 *       On first call, provisions the account via Paystack. On all subsequent
 *       calls, returns the saved account from the database instantly.
 *     tags: [Virtual Account]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Titan account details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 titanAccount:
 *                   type: object
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
 */
router.get("/account", authMiddleware, getOrCreateDVA);

/**
 * @swagger
 * /api/dva/provision:
 *   post:
 *     summary: Explicitly provision a Titan virtual account
 *     description: >
 *       Call this right after customer registration to pre-create the account.
 *       Idempotent — safe to call even if already provisioned.
 *     tags: [Virtual Account]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Titan account provisioned
 */
router.post("/provision", authMiddleware, provisionDVA);

module.exports = router;