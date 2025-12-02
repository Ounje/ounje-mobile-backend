const express = require("express");
const router = express.Router();
const payoutController = require("../controllers/payoutController");
const auth = require("../middleware/auth");

// All routes require authentication
router.use(auth);

/**
 * Get current balance
 * GET /api/payouts/balance
 */
router.get("/balance", payoutController.getBalance);

/**
 * Get transaction history
 * GET /api/payouts/history
 */
router.get("/history", payoutController.getTransactionHistory);

/**
 * Get pending payout requests
 * GET /api/payouts/pending
 */
router.get("/pending", payoutController.getPendingPayouts);

/**
 * Get account statement (for reconciliation)
 * GET /api/payouts/statement
 */
router.get("/statement", payoutController.getStatement);

/**
 * Request a payout
 * POST /api/payouts/request
 */
router.post("/request", payoutController.requestPayout);

/**
 * Cancel a payout request
 * PUT /api/payouts/:payoutId/cancel
 */
router.put("/:payoutId/cancel", payoutController.cancelPayout);

/**
 * Process payout (admin only)
 * PUT /api/payouts/:payoutId/process
 */
router.put("/:payoutId/process", payoutController.processPayout);

module.exports = router;
