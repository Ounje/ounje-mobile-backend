const express = require("express");
const router = express.Router();
const { authMiddleware, roleGuard } = require("../middleware/auth");
const reconcileController = require("../controllers/reconcileController");

// All reconciliation routes require a valid admin token
const requireAdmin = [authMiddleware, roleGuard(["admin"])];

/**
 * POST /api/admin/reconcile/run
 * Run full financial audit immediately.
 */
router.post("/run", requireAdmin, reconcileController.runReconciliation);

/**
 * GET /api/admin/reconcile/latest
 * Return the most recent audit report.
 */
router.get("/latest", requireAdmin, reconcileController.getLatestReport);

/**
 * GET /api/admin/reconcile/history
 * List all audit reports (paginated summary).
 */
router.get("/history", requireAdmin, reconcileController.getReportHistory);

/**
 * GET /api/admin/reconcile/:id
 * Fetch a specific report in full by its MongoDB ID.
 */
router.get("/:id", requireAdmin, reconcileController.getReportById);

module.exports = router;
