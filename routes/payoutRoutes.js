const express = require("express");
const router = express.Router();
const payoutController = require("../controllers/payoutController");
const { authMiddleware } = require("../middleware/auth");

// All routes require authentication

/**
 * @swagger
 * tags:
 *   name: Payouts
 *   description: Payout and Wallet Management
 */

/**
 * @swagger
 * /api/payouts/balance:
 *   get:
 *     summary: Get current wallet balance
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current balance
 */
router.get("/balance", authMiddleware, payoutController.getBalance);

/**
 * @swagger
 * /api/payouts/history:
 *   get:
 *     summary: Get transaction history
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction history
 */
router.get("/history", authMiddleware, payoutController.getTransactionHistory);

/**
 * @swagger
 * /api/payouts/withdrawals:
 *   get:
 *     summary: Get bank withdrawal history (Money Out)
 *     description: Returns a list of all bank transfers including Paystack fees and stamp duty deductions.
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of withdrawals with net amounts
 */
router.get("/withdrawals", authMiddleware, payoutController.getPayoutHistory);

/**
 * @swagger
 * /api/payouts/pending:
 *   get:
 *     summary: Get pending payout requests
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending payouts
 */
router.get("/pending", authMiddleware, payoutController.getPendingPayouts);

/**
 * @swagger
 * /api/payouts/statement:
 *   get:
 *     summary: Get account statement for reconciliation
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statement data
 */
router.get("/statement", authMiddleware, payoutController.getStatement);

/**
 * @swagger
 * /api/payouts/withdrawal-otp:
 *   post:
 *     summary: Send withdrawal OTP to the authenticated user's phone
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal OTP sent
 */
router.post(
	"/withdrawal-otp",
	authMiddleware,
	payoutController.requestWithdrawalOtp,
);

/**
 * @swagger
 * /api/payouts/request:
 *   post:
 *     summary: Request a payout
 *     tags: [Payouts]
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
 *             properties:
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Payout requested
 */
router.post("/request", authMiddleware, payoutController.requestPayout);

/**
 * @swagger
 * /api/payouts/{payoutId}/cancel:
 *   put:
 *     summary: Cancel a payout request
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: payoutId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payout cancelled
 */
router.put("/:payoutId/cancel", authMiddleware, payoutController.cancelPayout);

/**
 * @swagger
 * /api/payouts/{payoutId}/process:
 *   put:
 *     summary: Process a payout (Admin)
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: payoutId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payout processed
 */
router.put(
	"/:payoutId/process",
	authMiddleware,
	payoutController.processPayout,
);

/**
 * @swagger
 * /api/payouts/{payoutId}/retry:
 *   post:
 *     summary: Retry a payout (Admin)
 *     tags: [Payouts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: payoutId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payout retried
 */
router.post("/:payoutId/retry", authMiddleware, payoutController.retryPayout);

router.get("/fee-estimate", authMiddleware, payoutController.getFeeEstimate);

module.exports = router;
