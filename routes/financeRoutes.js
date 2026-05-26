const express = require("express");
const router = express.Router();
const { authMiddleware, roleGuard } = require("../middleware/auth");
const {
	getOverview,
	getTransactions,
	getRevenueSummary,
	getPayouts,
	getProfitSummary,
	getOrderStats,
} = require("../controllers/financeController");

// All finance routes are admin-only
const adminOnly = [authMiddleware, roleGuard(["admin"])];

/**
 * GET /api/finance/overview?period=today|week|month|year
 * GET /api/finance/overview?startDate=2026-01-01&endDate=2026-03-19
 * Platform-wide financial overview
 */
router.get("/overview", ...adminOnly, getOverview);

/**
 * GET /api/finance/transactions?period=today|week|month|year&page=1&limit=20
 * GET /api/finance/transactions?startDate=2026-01-01&endDate=2026-03-19
 * All completed order transactions with revenue breakdown
 */
router.get("/transactions", ...adminOnly, getTransactions);

/**
 * GET /api/finance/revenue-summary?groupBy=day|week|month
 * GET /api/finance/revenue-summary?groupBy=day&startDate=2026-01-01&endDate=2026-03-19
 * Revenue grouped by time period
 */
router.get("/revenue-summary", ...adminOnly, getRevenueSummary);

/**
 * GET /api/finance/payouts?period=today|week|month|year&status=completed|pending|failed
 * All payouts/withdrawals made to vendors and riders
 */
router.get("/payouts", ...adminOnly, getPayouts);

/**
 * GET /api/finance/profit?period=today|week|month|year
 * Gross profit, expenses, net profit and profit margin
 */
router.get("/profit", ...adminOnly, getProfitSummary);

/**
 * GET /api/finance/order-stats?period=today|week|month|year
 * Order counts and values broken down by status
 */
router.get("/order-stats", ...adminOnly, getOrderStats);

module.exports = router;
