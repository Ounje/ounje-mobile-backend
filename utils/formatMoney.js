/**
 * formatMoney.js
 * Central kobo → naira conversion utilities.
 * Import this in all controllers instead of defining toNaira locally.
 *
 * FIX: Math.round(kobo) / 100 was rounding the integer kobo value (no-op),
 *      producing whole-naira integers. e.g. ₦50.75 would display as ₦51.
 *      Correct form: Math.round(kobo / 100 * 100) / 100  →  2 decimal places.
 */

/** Convert kobo → naira, rounded to 2 decimal places */
const toNaira = (kobo) =>
	kobo != null ? Math.round((kobo / 100) * 100) / 100 : null;

/** Format a raw ledger balance object (all fields in kobo) into naira */
const formatBalance = (b) => ({
	availableBalance: toNaira(b.availableBalance ?? 0),
	pendingBalance: toNaira(b.pendingBalance ?? 0),
	holdBalance: toNaira(b.holdBalance ?? 0),
	totalBalance: toNaira(b.totalBalance ?? 0),
});

/** Format a single transaction record (amount + balanceAfter kobo → naira) */
const formatTransaction = (tx) => ({
	...(tx.toObject?.() ?? tx),
	amount: toNaira(tx.amount ?? 0),
	balanceAfter: toNaira(tx.balanceAfter ?? 0),
});

/** Format a fees object */
const formatFees = (fees) => ({
	paystackFee: toNaira(fees.paystackFee),
	stampDuty: toNaira(fees.stampDuty),
	total: toNaira(fees.total),
});

/** Format a payout document */
const formatPayout = (p) => ({
	payoutId: p._id,
	reference: p.reference,
	amount: toNaira(p.amount),
	feeDeducted: toNaira(p.feeDeducted),
	netAmount: toNaira(p.netAmount),
	status: p.status,
	transactionRef: p.transactionRef,
	processAt: p.processAt,
	requestedAt: p.createdAt,
	processedAt: p.processedAt,
	failureReason: p.failureReason,
});

module.exports = {
	toNaira,
	formatBalance,
	formatTransaction,
	formatFees,
	formatPayout,
};
