const payoutService = require("../services/payout.service");
const logger = require("../utils/logger");

/**
 * processAllPendingPayouts
 *
 * Called by the cron job every 15 minutes.
 * Delegates entirely to payout.service.processQueuedWithdrawals()
 * which handles locking, Paystack transfer, ledger settlement,
 * retry logic, and failure reversal.
 */
const processAllPendingPayouts = async () => {
	logger.info("[CRON] payoutProcessor — checking for queued withdrawals");

	try {
		const result = await payoutService.processQueuedWithdrawals();
		logger.info(
			`[CRON] payoutProcessor — done | processed=${result.processed} failed=${result.failed}`,
		);
		return result;
	} catch (err) {
		logger.error(`[CRON] payoutProcessor — fatal error: ${err.message}`, {
			stack: err.stack,
		});
		throw err;
	}
};

module.exports = { processAllPendingPayouts };
