/**
 * Financial Reconciliation Controller
 *
 * Exposes admin-only API endpoints to:
 *   POST /api/admin/reconcile/run        — Run full audit, save report to DB
 *   GET  /api/admin/reconcile/latest     — Fetch the most recent report
 *   GET  /api/admin/reconcile/history    — List all reports (paginated)
 *   GET  /api/admin/reconcile/:id        — Fetch a specific report by ID
 *
 * All audit logic lives in the reconcile service.
 */

const reconcileService = require("../services/reconcile.service");
const ReconciliationReport = require("../models/ReconciliationReport");
const logger = require("../utils/logger");

/**
 * POST /api/admin/reconcile/run
 * Run a full financial audit and persist the report.
 */
const runReconciliation = async (req, res) => {
	try {
		logger.info("[Reconcile] API triggered by admin");
		const report = await reconcileService.runFullAudit("api");
		return res.status(200).json({ success: true, report });
	} catch (err) {
		logger.error(`[Reconcile] runReconciliation error: ${err.message}`);
		return res.status(500).json({ success: false, error: err.message });
	}
};

/**
 * GET /api/admin/reconcile/latest
 * Return the most recently generated report.
 */
const getLatestReport = async (req, res) => {
	try {
		const report = await ReconciliationReport.findOne().sort({ runAt: -1 }).lean();
		if (!report) {
			return res.status(404).json({ success: false, message: "No reconciliation reports found. Run one first." });
		}
		return res.status(200).json({ success: true, report });
	} catch (err) {
		logger.error(`[Reconcile] getLatestReport error: ${err.message}`);
		return res.status(500).json({ success: false, error: err.message });
	}
};

/**
 * GET /api/admin/reconcile/history?page=1&limit=20
 * List all reports (summary only, no full check arrays).
 */
const getReportHistory = async (req, res) => {
	try {
		const page = Math.max(1, parseInt(req.query.page) || 1);
		const limit = Math.min(100, parseInt(req.query.limit) || 20);
		const skip = (page - 1) * limit;

		const [reports, total] = await Promise.all([
			ReconciliationReport.find()
				.sort({ runAt: -1 })
				.skip(skip)
				.limit(limit)
				.select("runAt triggeredBy durationMs summary errors createdAt")
				.lean(),
			ReconciliationReport.countDocuments(),
		]);

		return res.status(200).json({
			success: true,
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
			reports,
		});
	} catch (err) {
		logger.error(`[Reconcile] getReportHistory error: ${err.message}`);
		return res.status(500).json({ success: false, error: err.message });
	}
};

/**
 * GET /api/admin/reconcile/:id
 * Fetch a specific report in full.
 */
const getReportById = async (req, res) => {
	try {
		const report = await ReconciliationReport.findById(req.params.id).lean();
		if (!report) {
			return res.status(404).json({ success: false, message: "Report not found" });
		}
		return res.status(200).json({ success: true, report });
	} catch (err) {
		logger.error(`[Reconcile] getReportById error: ${err.message}`);
		return res.status(500).json({ success: false, error: err.message });
	}
};

module.exports = {
	runReconciliation,
	getLatestReport,
	getReportHistory,
	getReportById,
};
