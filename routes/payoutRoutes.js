const express = require("express");
const router = express.Router();
const payoutController = require("../controllers/payoutController");
const { authMiddleware } = require("../middleware/auth");

// All routes require authentication


/**
 * Get current balance
 * GET /api/payouts/balance
 */
router.get("/balance", authMiddleware, payoutController.getBalance);

/**
 * Get transaction history
 * GET /api/payouts/history
 */
router.get("/history", authMiddleware, payoutController.getTransactionHistory);

/**
 * Get pending payout requests
 * GET /api/payouts/pending
 */
router.get("/pending", authMiddleware, payoutController.getPendingPayouts);

/**
 * Get account statement (for reconciliation)
 * GET /api/payouts/statement
 */
router.get("/statement", authMiddleware, payoutController.getStatement);

/**
 * Request a payout
 * POST /api/payouts/request
 */
router.post("/request", authMiddleware, payoutController.requestPayout);

/**
 * Cancel a payout request
 * PUT /api/payouts/:payoutId/cancel
 */
router.put("/:payoutId/cancel", authMiddleware, payoutController.cancelPayout);

/**
 * Process payout (admin only)
 * PUT /api/payouts/:payoutId/process
 */
router.put("/:payoutId/process", authMiddleware, payoutController.processPayout);

/**
 * Retry a payout (admin only)
 * POST /api/payouts/:payoutId/retry
 */
router.post("/:payoutId/retry", authMiddleware, payoutController.retryPayout);

module.exports = router;
