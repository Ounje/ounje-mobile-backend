const mongoose = require("mongoose");

/**
 * ReconciliationReport
 *
 * Stores the result of each financial audit run.
 * Each run produces one document containing the full findings from all 10 checks.
 */
const reconciliationReportSchema = new mongoose.Schema(
	{
		runAt: { type: Date, default: Date.now, index: true },
		triggeredBy: { type: String, default: "manual" }, // "manual" | "scheduled" | "api"
		durationMs: { type: Number },

		summary: {
			totalIssues: { type: Number, default: 0 },
			criticalIssues: { type: Number, default: 0 },
			warningIssues: { type: Number, default: 0 },
			infoIssues: { type: Number, default: 0 },
		},

		checks: {
			orphanedPayments: { type: mongoose.Schema.Types.Mixed, default: [] },
			missingRefunds: { type: mongoose.Schema.Types.Mixed, default: [] },
			duplicateLedgerEntries: { type: mongoose.Schema.Types.Mixed, default: [] },
			balanceMismatches: { type: mongoose.Schema.Types.Mixed, default: [] },
			payoutsMissingLedger: { type: mongoose.Schema.Types.Mixed, default: [] },
			paidOrdersNotCompleted: { type: mongoose.Schema.Types.Mixed, default: [] },
			declinedOrdersNotRefunded: { type: mongoose.Schema.Types.Mixed, default: [] },
			holdLeaks: { type: mongoose.Schema.Types.Mixed, default: [] },
			pendingCheckoutLeaks: { type: mongoose.Schema.Types.Mixed, default: [] },
			paystackVsDbMismatch: { type: mongoose.Schema.Types.Mixed, default: [] },
		},

		// Optional raw error log if any check threw
		errors: [{ check: String, message: String }],
	},
	{ timestamps: true },
);

reconciliationReportSchema.index({ runAt: -1 });

module.exports = mongoose.model("ReconciliationReport", reconciliationReportSchema);
