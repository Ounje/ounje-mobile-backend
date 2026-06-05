/**
 * Reconciliation Service — Full Financial Audit
 *
 * Runs 10 audit checks across Orders, Payments, LedgerAccounts,
 * LedgerEntries, Payouts, PendingCheckouts, and Paystack.
 *
 * ALL AMOUNTS ARE IN NAIRA (the ledger's unit of measure).
 *
 * Checks:
 *   1.  orphanedPayments          — Payment success but no Order created
 *   2.  missingRefunds            — Declined/cancelled orders with paymentStatus=paid but no REFUND ledger entry
 *   3.  duplicateLedgerEntries    — Same orderId + accountId + reason appearing more than once (true duplicates)
 *   4.  balanceMismatches         — LedgerAccount snapshot balance ≠ sum of LedgerEntry history
 *   5.  payoutsMissingLedger      — Successful payouts with no corresponding ledger debit
 *   6.  paidOrdersNotCompleted    — Orders paid but stuck in confirming for > 30 min
 *   7.  declinedOrdersNotRefunded — Declined/cancelled paid orders with no REFUND ledger entry
 *   8.  holdLeaks                 — VENDOR_EARNING_HOLD / DELIVERY_FEE_HOLD on terminal orders with no release
 *   9.  pendingCheckoutLeaks      — PendingCheckout docs older than 2 hours
 *   10. paystackVsDbMismatch      — Paystack transaction list vs Payment collection cross-reference
 */

const mongoose = require("mongoose");
const axios = require("axios");
const logger = require("../utils/logger");
const ReconciliationReport = require("../models/ReconciliationReport");

// ─── Lazy model loading (safe for both script and server contexts) ─────────────

const getModels = () => ({
	Order: mongoose.model("Order"),
	Payment: mongoose.model("Payment"),
	LedgerAccount: mongoose.model("LedgerAccount"),
	LedgerEntry: mongoose.model("LedgerEntry"),
	Payout: mongoose.model("Payout"),
	PendingCheckout: mongoose.model("PendingCheckout"),
	Customer: mongoose.model("Customer"),
});

// ─── Paystack API client ───────────────────────────────────────────────────────

const paystackClient = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
	timeout: 30000,
});

// ─── BALANCE RECONSTRUCTION LOGIC ─────────────────────────────────────────────
// Reasons that move money between buckets (not into/out of the system)
const BUCKET_TRANSFER_REASONS = new Set([
	"VENDOR_EARNING_HOLD",
	"DELIVERY_FEE_HOLD",
	"VENDOR_ORDER_PENDING",
	"PAYOUT_PENDING",
]);

// Reasons that move money out of hold/pending buckets
const HOLD_DEBIT_REASONS = new Set(["REVERSAL"]);
const PENDING_DEBIT_REASONS = new Set(["PAYOUT", "REVERSAL"]);

// ─── CHECK 1: Orphaned Payments ───────────────────────────────────────────────
const checkOrphanedPayments = async () => {
	const { Payment, PendingCheckout } = getModels();

	const successPayments = await Payment.find({ status: "success", orderId: null })
		.select("_id reference amount customer paidAt createdAt")
		.lean();

	const results = [];
	for (const p of successPayments) {
		// If there's still a PendingCheckout, it may just not have been processed yet
		const pending = await PendingCheckout.findOne({ reference: p.reference }).lean();
		if (!pending) {
			results.push({
				severity: "CRITICAL",
				paymentId: p._id,
				reference: p.reference,
				amountNaira: p.amount,
				customerId: p.customer,
				paidAt: p.paidAt || p.createdAt,
				issue: "Payment is success but no Order exists and no PendingCheckout — money received with no order created",
			});
		} else {
			results.push({
				severity: "WARNING",
				paymentId: p._id,
				reference: p.reference,
				amountNaira: p.amount,
				customerId: p.customer,
				paidAt: p.paidAt || p.createdAt,
				issue: "Payment is success but Order not yet created — PendingCheckout still exists (may be in-flight)",
				pendingCheckoutId: pending._id,
				pendingCheckoutAge: Math.round((Date.now() - new Date(pending.createdAt).getTime()) / 60000) + " minutes",
			});
		}
	}

	return results;
};

// ─── CHECK 2 & 7: Declined/Cancelled Orders Not Refunded ─────────────────────
// (Check 2 = general, Check 7 = explicit — merged into one function)
const checkMissingRefunds = async () => {
	const { Order, LedgerAccount, LedgerEntry } = getModels();

	const terminalOrders = await Order.find({
		status: { $in: ["declined", "cancelled"] },
		paymentStatus: "paid",
	})
		.select("_id orderNumber totalPrice paymentMethod customer vendor createdAt declinedAt cancelledAt status")
		.lean();

	const results = [];

	for (const order of terminalOrders) {
		// Find the customer's ledger account
		const account = await LedgerAccount.findOne({ userId: order.customer, type: "CUSTOMER" }).lean();

		let hasRefundEntry = false;
		if (account) {
			const refundEntry = await LedgerEntry.findOne({
				accountId: account._id,
				orderId: order._id,
				reason: "REFUND",
			}).lean();
			hasRefundEntry = !!refundEntry;
		}

		if (!hasRefundEntry) {
			const ageHours = Math.round((Date.now() - new Date(order.declinedAt || order.cancelledAt || order.createdAt).getTime()) / 3600000);
			results.push({
				severity: "CRITICAL",
				orderId: order._id,
				orderNumber: order.orderNumber,
				status: order.status,
				paymentMethod: order.paymentMethod,
				amountNaira: order.totalPrice,
				customerId: order.customer,
				vendorId: order.vendor,
				terminatedAt: order.declinedAt || order.cancelledAt,
				ageHours,
				issue: `Order is ${order.status} with paymentStatus=paid but NO REFUND LedgerEntry exists — customer money not returned`,
			});
		}
	}

	return results;
};

// ─── CHECK 3: Duplicate Ledger Entries ────────────────────────────────────────
const checkDuplicateLedgerEntries = async () => {
	const { LedgerEntry } = getModels();

	// Only check reasons where duplicates are definitely wrong
	// (VENDOR_EARNING_HOLD, DELIVERY_FEE_HOLD, REFUND, WALLET_PAYMENT, DVA_TRANSFER)
	const suspectReasons = ["VENDOR_EARNING_HOLD", "DELIVERY_FEE_HOLD", "REFUND", "WALLET_PAYMENT", "DVA_TRANSFER", "ORDER_EARNING"];

	const duplicates = await LedgerEntry.aggregate([
		{
			$match: {
				orderId: { $exists: true, $ne: null },
				reason: { $in: suspectReasons },
			},
		},
		{
			$group: {
				_id: { accountId: "$accountId", orderId: "$orderId", reason: "$reason" },
				count: { $sum: 1 },
				totalAmount: { $sum: "$amount" },
				entryIds: { $push: "$_id" },
				entryTypes: { $addToSet: "$entryType" },
			},
		},
		{
			$match: { count: { $gt: 1 } },
		},
	]);

	return duplicates.map((d) => ({
		severity: "CRITICAL",
		accountId: d._id.accountId,
		orderId: d._id.orderId,
		reason: d._id.reason,
		duplicateCount: d.count,
		totalAmountNaira: d.totalAmount,
		entryIds: d.entryIds,
		issue: `Found ${d.count} LedgerEntries for the same order+account+reason — possible double debit/credit of ₦${d.totalAmount}`,
	}));
};

// ─── CHECK 4: Balance Mismatches ──────────────────────────────────────────────
const checkBalanceMismatches = async () => {
	const { LedgerAccount, LedgerEntry } = getModels();

	const accounts = await LedgerAccount.find().lean();
	const results = [];

	for (const account of accounts) {
		const entries = await LedgerEntry.find({ accountId: account._id }).lean();

		let computedAvailable = 0;
		let computedPending = 0;
		let computedHold = 0;

		for (const e of entries) {
			const amt = e.amount;
			const isCredit = e.entryType === "CREDIT";

			if (e.reason === "VENDOR_EARNING_HOLD" || e.reason === "DELIVERY_FEE_HOLD") {
				// These credit the holdBalance
				computedHold += isCredit ? amt : -amt;
			} else if (e.reason === "VENDOR_ORDER_PENDING") {
				// Moves from hold to pendingBalance (credit side)
				computedHold -= isCredit ? amt : 0;
				computedPending += isCredit ? amt : 0;
			} else if (e.reason === "PAYOUT_PENDING") {
				// Moves from available to pendingBalance
				computedAvailable -= isCredit ? 0 : amt;
				computedPending += isCredit ? 0 : -(-amt); // debit of available
				// Actually PAYOUT_PENDING is a DEBIT on available → store as pending
				if (!isCredit) {
					computedAvailable -= amt; // was subtracted from available
					computedPending += amt;   // added to pending
				}
			} else if (e.reason === "PAYOUT") {
				// Final debit from pendingBalance (money left system)
				if (!isCredit) computedPending -= amt;
			} else if (e.reason === "REVERSAL") {
				// Can reverse hold, pending or available — use balance change direction
				if (isCredit) computedAvailable += amt;
				else computedHold -= amt; // reversal of a hold
			} else {
				// Standard credit/debit on available (REFUND, WALLET_PAYMENT, ORDER_EARNING, DVA_TRANSFER, etc.)
				if (isCredit) computedAvailable += amt;
				else computedAvailable -= amt;
			}
		}

		// Round to 2 decimal places to eliminate floating-point noise
		const round = (n) => Math.round(n * 100) / 100;
		const tolerance = 1; // ₦1 tolerance

		const availableDiff = round(Math.abs(account.availableBalance - computedAvailable));
		const pendingDiff = round(Math.abs(account.pendingBalance - computedPending));
		const holdDiff = round(Math.abs(account.holdBalance - computedHold));

		if (availableDiff > tolerance || pendingDiff > tolerance || holdDiff > tolerance) {
			results.push({
				severity: availableDiff > 100 || pendingDiff > 100 ? "CRITICAL" : "WARNING",
				accountId: account._id,
				userId: account.userId,
				accountType: account.type,
				stored: {
					availableBalance: account.availableBalance,
					pendingBalance: account.pendingBalance,
					holdBalance: account.holdBalance,
				},
				computed: {
					availableBalance: round(computedAvailable),
					pendingBalance: round(computedPending),
					holdBalance: round(computedHold),
				},
				discrepancy: {
					available: availableDiff,
					pending: pendingDiff,
					hold: holdDiff,
				},
				entryCount: entries.length,
				issue: "LedgerAccount snapshot balance does not match sum of LedgerEntry history",
			});
		}
	}

	return results;
};

// ─── CHECK 5: Payouts Missing Ledger Entry ────────────────────────────────────
const checkPayoutsMissingLedger = async () => {
	const { Payout, LedgerEntry } = getModels();

	const successPayouts = await Payout.find({ status: "success" })
		.select("_id reference transactionRef recipientId recipientType amount netAmount ledgerEntry processedAt")
		.lean();

	const results = [];

	for (const payout of successPayouts) {
		if (!payout.ledgerEntry) {
			results.push({
				severity: "CRITICAL",
				payoutId: payout._id,
				reference: payout.reference,
				transferCode: payout.transactionRef,
				recipientId: payout.recipientId,
				recipientType: payout.recipientType,
				amountNaira: payout.amount,
				netAmountNaira: payout.netAmount,
				processedAt: payout.processedAt,
				issue: "Payout is success but ledgerEntry reference is missing — completePayout may not have run",
			});
		} else {
			// Verify the entry actually exists
			const entry = await LedgerEntry.findById(payout.ledgerEntry).lean();
			if (!entry) {
				results.push({
					severity: "CRITICAL",
					payoutId: payout._id,
					reference: payout.reference,
					recipientId: payout.recipientId,
					recipientType: payout.recipientType,
					amountNaira: payout.amount,
					ledgerEntryId: payout.ledgerEntry,
					issue: "Payout ledgerEntry ID exists but the LedgerEntry document was deleted or never created",
				});
			}
		}
	}

	return results;
};

// ─── CHECK 6: Paid Orders Stuck in Confirming ────────────────────────────────
const checkPaidOrdersNotCompleted = async () => {
	const { Order } = getModels();

	const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

	const stuckOrders = await Order.find({
		paymentStatus: "paid",
		status: "confirming",
		createdAt: { $lte: thirtyMinutesAgo },
	})
		.select("_id orderNumber totalPrice paymentMethod customer vendor createdAt")
		.lean();

	return stuckOrders.map((o) => ({
		severity: "WARNING",
		orderId: o._id,
		orderNumber: o.orderNumber,
		paymentMethod: o.paymentMethod,
		amountNaira: o.totalPrice,
		customerId: o.customer,
		vendorId: o.vendor,
		createdAt: o.createdAt,
		stuckForMinutes: Math.round((Date.now() - new Date(o.createdAt).getTime()) / 60000),
		issue: "Order is paid but stuck in confirming for >30 minutes — vendor may not have been notified",
	}));
};

// ─── CHECK 8: Hold Leaks ──────────────────────────────────────────────────────
const checkHoldLeaks = async () => {
	const { Order, LedgerAccount, LedgerEntry } = getModels();

	// Find all orders in a terminal state (delivered, declined, cancelled)
	const terminalOrders = await Order.find({
		status: { $in: ["delivered", "declined", "cancelled"] },
	})
		.select("_id vendor rider status")
		.lean();

	const results = [];

	for (const order of terminalOrders) {
		// Check vendor hold
		const vendorAccount = await LedgerAccount.findOne({ userId: order.vendor, type: "VENDOR" }).lean();
		if (vendorAccount) {
			const vendorHold = await LedgerEntry.findOne({
				accountId: vendorAccount._id,
				orderId: order._id,
				reason: "VENDOR_EARNING_HOLD",
			}).lean();

			if (vendorHold) {
				// Check if there's a corresponding release or reversal
				const vendorRelease = await LedgerEntry.findOne({
					accountId: vendorAccount._id,
					orderId: order._id,
					reason: { $in: ["ORDER_EARNING", "REVERSAL", "VENDOR_ORDER_PENDING"] },
				}).lean();

				if (!vendorRelease) {
					results.push({
						severity: "CRITICAL",
						type: "VENDOR_HOLD_LEAK",
						orderId: order._id,
						orderStatus: order.status,
						vendorId: order.vendor,
						vendorAccountId: vendorAccount._id,
						holdAmount: vendorHold.amount,
						holdEntryId: vendorHold._id,
						issue: `Order is ${order.status} but VENDOR_EARNING_HOLD of ₦${vendorHold.amount} was never released or reversed — holdBalance inflated`,
					});
				}
			}
		}

		// Check rider hold (only for orders that had a rider)
		if (order.rider) {
			const riderAccount = await LedgerAccount.findOne({ userId: order.rider, type: "RIDER" }).lean();
			if (riderAccount) {
				const riderHold = await LedgerEntry.findOne({
					accountId: riderAccount._id,
					orderId: order._id,
					reason: "DELIVERY_FEE_HOLD",
				}).lean();

				if (riderHold) {
					const riderRelease = await LedgerEntry.findOne({
						accountId: riderAccount._id,
						orderId: order._id,
						reason: { $in: ["ORDER_EARNING", "REVERSAL"] },
					}).lean();

					if (!riderRelease) {
						results.push({
							severity: "CRITICAL",
							type: "RIDER_HOLD_LEAK",
							orderId: order._id,
							orderStatus: order.status,
							riderId: order.rider,
							riderAccountId: riderAccount._id,
							holdAmount: riderHold.amount,
							holdEntryId: riderHold._id,
							issue: `Order is ${order.status} but DELIVERY_FEE_HOLD of ₦${riderHold.amount} was never released or reversed — holdBalance inflated`,
						});
					}
				}
			}
		}
	}

	return results;
};

// ─── CHECK 9: Pending Checkout Leaks ─────────────────────────────────────────
const checkPendingCheckoutLeaks = async () => {
	const { PendingCheckout, Payment } = getModels();

	const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

	const stalePending = await PendingCheckout.find({
		createdAt: { $lte: twoHoursAgo },
	})
		.select("_id reference customerId createdAt")
		.lean();

	const results = [];

	for (const pc of stalePending) {
		const payment = await Payment.findOne({ reference: pc.reference })
			.select("status amount paidAt")
			.lean();

		const ageHours = Math.round((Date.now() - new Date(pc.createdAt).getTime()) / 3600000);

		results.push({
			severity: payment?.status === "success" ? "CRITICAL" : "WARNING",
			pendingCheckoutId: pc._id,
			reference: pc.reference,
			customerId: pc.customerId,
			createdAt: pc.createdAt,
			ageHours,
			paymentStatus: payment?.status || "not_found",
			paymentAmountNaira: payment?.amount,
			issue: payment?.status === "success"
				? "Payment succeeded but PendingCheckout was never cleared — order may be missing"
				: "PendingCheckout is stale (>2h) — payment may have failed silently or webhook was missed",
		});
	}

	return results;
};

// ─── CHECK 10: Paystack vs DB Mismatch ───────────────────────────────────────
const checkPaystackVsDbMismatch = async () => {
	const { Payment } = getModels();

	if (!process.env.PAYSTACK_SECRET_KEY) {
		return [{ severity: "INFO", issue: "PAYSTACK_SECRET_KEY not configured — skipping Paystack cross-reference check" }];
	}

	let paystackTransactions = [];
	try {
		// Fetch last 200 transactions from Paystack
		const response = await paystackClient.get("/transaction?perPage=200&status=success");
		paystackTransactions = response.data?.data || [];
	} catch (err) {
		logger.error(`[Reconcile] Paystack API fetch failed: ${err.message}`);
		return [{ severity: "WARNING", issue: `Could not fetch Paystack transactions: ${err.message}` }];
	}

	const results = [];

	for (const tx of paystackTransactions) {
		const reference = tx.reference;
		const paystackAmountNaira = tx.amount / 100;
		const paystackStatus = tx.status; // "success"

		const dbPayment = await Payment.findOne({ reference }).lean();

		if (!dbPayment) {
			// Paystack has a success record but we have nothing in DB
			results.push({
				severity: "CRITICAL",
				reference,
				paystackAmountNaira,
				paystackStatus,
				paystackPaidAt: tx.paid_at,
				paystackChannel: tx.channel,
				issue: "Paystack shows a successful charge but NO Payment record exists in the database — webhook may have been missed",
			});
		} else if (dbPayment.status !== "success") {
			// DB has the payment but it's still pending/failed
			results.push({
				severity: "CRITICAL",
				reference,
				paystackAmountNaira,
				dbAmountNaira: dbPayment.amount,
				paystackStatus,
				dbStatus: dbPayment.status,
				paymentId: dbPayment._id,
				issue: `Paystack shows success but DB Payment status is "${dbPayment.status}" — webhook may not have updated the record`,
			});
		} else if (Math.abs(paystackAmountNaira - dbPayment.amount) > 1) {
			// Amount mismatch (more than ₦1 difference)
			results.push({
				severity: "CRITICAL",
				reference,
				paystackAmountNaira,
				dbAmountNaira: dbPayment.amount,
				discrepancyNaira: Math.abs(paystackAmountNaira - dbPayment.amount),
				paymentId: dbPayment._id,
				issue: `Amount mismatch: Paystack shows ₦${paystackAmountNaira} but DB shows ₦${dbPayment.amount} — possible unit conversion error`,
			});
		}
	}

	// Also check DB payments marked success that have no Paystack record
	const paystackRefs = new Set(paystackTransactions.map((tx) => tx.reference));
	const dbSuccessPayments = await Payment.find({ status: "success" })
		.select("reference amount customer paidAt")
		.limit(200)
		.lean();

	for (const p of dbSuccessPayments) {
		if (!paystackRefs.has(p.reference)) {
			// DVA top-ups have a dedicated_nuban channel — these may not appear in standard transaction list
			// Flag as INFO rather than critical
			results.push({
				severity: "INFO",
				reference: p.reference,
				dbAmountNaira: p.amount,
				customerId: p.customer,
				paidAt: p.paidAt,
				issue: "DB Payment is success but reference not found in last 200 Paystack transactions — may be a DVA top-up or older than 200 records",
			});
		}
	}

	return results;
};

// ─── MAIN AUDIT RUNNER ────────────────────────────────────────────────────────

const runFullAudit = async (triggeredBy = "manual") => {
	const startTime = Date.now();
	logger.info(`[Reconcile] Starting full financial audit (triggeredBy=${triggeredBy})`);

	const reportData = {
		triggeredBy,
		checks: {},
		reconciliationErrors: [],
		summary: { totalIssues: 0, criticalIssues: 0, warningIssues: 0, infoIssues: 0 },
	};

	const runCheck = async (name, fn) => {
		try {
			logger.info(`[Reconcile] Running check: ${name}`);
			const results = await fn();
			reportData.checks[name] = results;

			for (const r of results) {
				reportData.summary.totalIssues++;
				if (r.severity === "CRITICAL") reportData.summary.criticalIssues++;
				else if (r.severity === "WARNING") reportData.summary.warningIssues++;
				else reportData.summary.infoIssues++;
			}

			logger.info(`[Reconcile] ${name}: ${results.length} issue(s) found`);
		} catch (err) {
			logger.error(`[Reconcile] Check "${name}" threw: ${err.message}`);
			reportData.reconciliationErrors.push({ check: name, message: err.message });
			reportData.checks[name] = [];
		}
	};

	await runCheck("orphanedPayments", checkOrphanedPayments);
	await runCheck("missingRefunds", checkMissingRefunds);
	await runCheck("duplicateLedgerEntries", checkDuplicateLedgerEntries);
	await runCheck("balanceMismatches", checkBalanceMismatches);
	await runCheck("payoutsMissingLedger", checkPayoutsMissingLedger);
	await runCheck("paidOrdersNotCompleted", checkPaidOrdersNotCompleted);
	await runCheck("declinedOrdersNotRefunded", checkMissingRefunds); // same logic, alias
	await runCheck("holdLeaks", checkHoldLeaks);
	await runCheck("pendingCheckoutLeaks", checkPendingCheckoutLeaks);
	await runCheck("paystackVsDbMismatch", checkPaystackVsDbMismatch);

	reportData.durationMs = Date.now() - startTime;
	reportData.runAt = new Date();

	// Save to MongoDB
	const savedReport = await ReconciliationReport.create(reportData);

	logger.info(
		`[Reconcile] Audit complete — ${reportData.summary.totalIssues} total issues ` +
		`(${reportData.summary.criticalIssues} critical, ${reportData.summary.warningIssues} warnings, ${reportData.summary.infoIssues} info) ` +
		`in ${reportData.durationMs}ms — reportId=${savedReport._id}`
	);

	return savedReport.toObject();
};

module.exports = {
	runFullAudit,
	// Export individual checks for direct use / testing
	checkOrphanedPayments,
	checkMissingRefunds,
	checkDuplicateLedgerEntries,
	checkBalanceMismatches,
	checkPayoutsMissingLedger,
	checkPaidOrdersNotCompleted,
	checkHoldLeaks,
	checkPendingCheckoutLeaks,
	checkPaystackVsDbMismatch,
};
