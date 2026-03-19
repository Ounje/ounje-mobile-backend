const { Order, Payout, LedgerEntry, LedgerAccount } = require("../models");
const mongoose = require("mongoose");

// ── Helper: build date range ─────────────────────────────────────────────────
const getDateRange = (period, startDate, endDate) => {
	const now = new Date();

	if (startDate && endDate) {
		const start = new Date(startDate);
		start.setHours(0, 0, 0, 0);
		const end = new Date(endDate);
		end.setHours(23, 59, 59, 999);
		return { start, end };
	}

	let start = new Date();
	let end = new Date();
	end.setHours(23, 59, 59, 999);

	switch (period) {
		case "today":
			start.setHours(0, 0, 0, 0);
			break;
		case "week":
			start.setDate(now.getDate() - 7);
			start.setHours(0, 0, 0, 0);
			break;
		case "month":
			start.setDate(1);
			start.setHours(0, 0, 0, 0);
			break;
		case "year":
			start = new Date(now.getFullYear(), 0, 1);
			break;
		default:
			start.setHours(0, 0, 0, 0); // default to today
	}

	return { start, end };
};

// ── 1. Platform Overview ─────────────────────────────────────────────────────
/**
 * GET /api/finance/overview?period=today|week|month|year
 * GET /api/finance/overview?startDate=2026-01-01&endDate=2026-03-19
 *
 * Returns: gross revenue, commission earned, service fees,
 *          total payouts, net platform profit, order count
 */
const getOverview = async (req, res) => {
	try {
		const { period = "today", startDate, endDate } = req.query;
		const { start, end } = getDateRange(period, startDate, endDate);

		// All delivered orders in period
		const orders = await Order.find({
			status: "DELIVERED",
			createdAt: { $gte: start, $lte: end },
		}).select("totalPrice deliveryFee serviceFee");

		const orderCount = orders.length;
		const grossRevenue = orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
		const totalDeliveryFees = orders.reduce((sum, o) => sum + (o.deliveryFee || 0), 0);
		const totalServiceFees = orders.reduce((sum, o) => sum + (o.serviceFee || 0), 0);

		// Commission = 10% of (totalPrice - deliveryFee - serviceFee)
		const foodTotal = grossRevenue - totalDeliveryFees - totalServiceFees;
		const commissionEarned = Math.round(foodTotal * 0.1);

		// Total payouts (expenses) — completed payouts in period
		const payouts = await Payout.find({
			status: "completed",
			processedAt: { $gte: start, $lte: end },
		}).select("amount");
		const totalPayouts = payouts.reduce((sum, p) => sum + (p.amount || 0), 0);

		// Net platform profit = commission + service fees - operational expenses
		const netProfit = commissionEarned + totalServiceFees - totalPayouts;

		res.json({
			success: true,
			period: { from: start, to: end },
			overview: {
				orderCount,
				grossRevenue,
				foodTotal,
				commissionEarned,
				totalServiceFees,
				totalDeliveryFees,
				totalPayouts,
				netProfit,
			},
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

// ── 2. Transactions ──────────────────────────────────────────────────────────
/**
 * GET /api/finance/transactions?period=today|week|month|year&page=1&limit=20
 *
 * Returns all completed orders with revenue breakdown per order
 */
const getTransactions = async (req, res) => {
	try {
		const { period = "today", startDate, endDate, page = 1, limit = 20 } = req.query;
		const { start, end } = getDateRange(period, startDate, endDate);

		const skip = (parseInt(page) - 1) * parseInt(limit);

		const [orders, total] = await Promise.all([
			Order.find({
				status: "DELIVERED",
				createdAt: { $gte: start, $lte: end },
			})
				.select("orderNumber totalPrice deliveryFee serviceFee zone createdAt placedAt")
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(parseInt(limit)),
			Order.countDocuments({
				status: "DELIVERED",
				createdAt: { $gte: start, $lte: end },
			}),
		]);

		const transactions = orders.map((o) => {
			const foodTotal = (o.totalPrice || 0) - (o.deliveryFee || 0) - (o.serviceFee || 0);
			const commission = Math.round(foodTotal * 0.1);
			return {
				orderNumber: o.orderNumber,
				orderId: o._id,
				grossAmount: o.totalPrice,
				deliveryFee: o.deliveryFee,
				serviceFee: o.serviceFee,
				foodTotal,
				commission,
				zone: o.zone,
				date: o.createdAt,
			};
		});

		res.json({
			success: true,
			period: { from: start, to: end },
			pagination: {
				total,
				page: parseInt(page),
				limit: parseInt(limit),
				pages: Math.ceil(total / parseInt(limit)),
			},
			transactions,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

// ── 3. Revenue Summary (Daily/Weekly/Monthly/Yearly breakdown) ───────────────
/**
 * GET /api/finance/revenue-summary?groupBy=day|week|month
 * GET /api/finance/revenue-summary?groupBy=day&startDate=2026-01-01&endDate=2026-03-19
 *
 * Returns revenue grouped by time period
 */
const getRevenueSummary = async (req, res) => {
	try {
		const { groupBy = "day", startDate, endDate } = req.query;

		let start, end;
		if (startDate && endDate) {
			start = new Date(startDate);
			start.setHours(0, 0, 0, 0);
			end = new Date(endDate);
			end.setHours(23, 59, 59, 999);
		} else {
			// Default: last 30 days
			end = new Date();
			end.setHours(23, 59, 59, 999);
			start = new Date();
			start.setDate(start.getDate() - 30);
			start.setHours(0, 0, 0, 0);
		}

		let dateFormat;
		switch (groupBy) {
			case "month":
				dateFormat = { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } };
				break;
			case "week":
				dateFormat = { year: { $year: "$createdAt" }, week: { $week: "$createdAt" } };
				break;
			default: // day
				dateFormat = { year: { $year: "$createdAt" }, month: { $month: "$createdAt" }, day: { $dayOfMonth: "$createdAt" } };
		}

		const summary = await Order.aggregate([
			{
				$match: {
					status: "DELIVERED",
					createdAt: { $gte: start, $lte: end },
				},
			},
			{
				$group: {
					_id: dateFormat,
					orderCount: { $sum: 1 },
					grossRevenue: { $sum: "$totalPrice" },
					totalDeliveryFees: { $sum: "$deliveryFee" },
					totalServiceFees: { $sum: "$serviceFee" },
				},
			},
			{ $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
		]);

		const result = summary.map((s) => {
			const foodTotal = s.grossRevenue - s.totalDeliveryFees - s.totalServiceFees;
			return {
				period: s._id,
				orderCount: s.orderCount,
				grossRevenue: s.grossRevenue,
				foodTotal,
				commission: Math.round(foodTotal * 0.1),
				totalServiceFees: s.totalServiceFees,
				totalDeliveryFees: s.totalDeliveryFees,
			};
		});

		res.json({
			success: true,
			groupBy,
			dateRange: { from: start, to: end },
			summary: result,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

// ── 4. Payouts / Withdrawals ─────────────────────────────────────────────────
/**
 * GET /api/finance/payouts?period=today|week|month|year&status=completed|pending|failed
 *
 * Returns all payouts/withdrawals made to vendors and riders
 */
const getPayouts = async (req, res) => {
	try {
		const { period = "month", startDate, endDate, status, page = 1, limit = 20 } = req.query;
		const { start, end } = getDateRange(period, startDate, endDate);

		const query = { createdAt: { $gte: start, $lte: end } };
		if (status) query.status = status;

		const skip = (parseInt(page) - 1) * parseInt(limit);

		const [payouts, total] = await Promise.all([
			Payout.find(query)
				.select("amount userType status createdAt processedAt transactionRef")
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(parseInt(limit)),
			Payout.countDocuments(query),
		]);

		// Totals
		const allPayouts = await Payout.find(query).select("amount status userType");
		const totalCompleted = allPayouts.filter(p => p.status === "completed").reduce((s, p) => s + p.amount, 0);
		const totalPending = allPayouts.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0);
		const totalFailed = allPayouts.filter(p => p.status === "failed").reduce((s, p) => s + p.amount, 0);
		const totalVendorPayouts = allPayouts.filter(p => p.userType === "VENDOR" && p.status === "completed").reduce((s, p) => s + p.amount, 0);
		const totalRiderPayouts = allPayouts.filter(p => p.userType === "RIDER" && p.status === "completed").reduce((s, p) => s + p.amount, 0);

		res.json({
			success: true,
			period: { from: start, to: end },
			summary: {
				totalCompleted,
				totalPending,
				totalFailed,
				totalVendorPayouts,
				totalRiderPayouts,
			},
			pagination: {
				total,
				page: parseInt(page),
				limit: parseInt(limit),
				pages: Math.ceil(total / parseInt(limit)),
			},
			payouts,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

// ── 5. Gross vs Net Profit ───────────────────────────────────────────────────
/**
 * GET /api/finance/profit?period=today|week|month|year
 *
 * Returns gross profit, expenses, and net profit
 */
const getProfitSummary = async (req, res) => {
	try {
		const { period = "month", startDate, endDate } = req.query;
		const { start, end } = getDateRange(period, startDate, endDate);

		// Revenue from orders
		const orders = await Order.find({
			status: "DELIVERED",
			createdAt: { $gte: start, $lte: end },
		}).select("totalPrice deliveryFee serviceFee");

		const grossRevenue = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
		const totalDeliveryFees = orders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
		const totalServiceFees = orders.reduce((s, o) => s + (o.serviceFee || 0), 0);
		const foodTotal = grossRevenue - totalDeliveryFees - totalServiceFees;
		const commissionEarned = Math.round(foodTotal * 0.1);

		// Platform income = commission + service fees
		const grossProfit = commissionEarned + totalServiceFees;

		// Expenses = completed payouts sent out
		const completedPayouts = await Payout.find({
			status: "completed",
			processedAt: { $gte: start, $lte: end },
		}).select("amount");
		const totalExpenses = completedPayouts.reduce((s, p) => s + p.amount, 0);

		// Net profit
		const netProfit = grossProfit - totalExpenses;

		res.json({
			success: true,
			period: { from: start, to: end },
			profit: {
				grossRevenue,
				foodTotal,
				commissionEarned,
				totalServiceFees,
				totalDeliveryFees,
				grossProfit,
				totalExpenses,
				netProfit,
				profitMargin: grossProfit > 0 ? ((netProfit / grossProfit) * 100).toFixed(2) + "%" : "0%",
			},
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

// ── 6. Order Stats ────────────────────────────────────────────────────────────
/**
 * GET /api/finance/order-stats?period=today|week|month|year
 *
 * Returns order counts by status
 */
const getOrderStats = async (req, res) => {
	try {
		const { period = "today", startDate, endDate } = req.query;
		const { start, end } = getDateRange(period, startDate, endDate);

		const stats = await Order.aggregate([
			{ $match: { createdAt: { $gte: start, $lte: end } } },
			{ $group: { _id: "$status", count: { $sum: 1 }, totalValue: { $sum: "$totalPrice" } } },
			{ $sort: { count: -1 } },
		]);

		const total = stats.reduce((s, st) => s + st.count, 0);

		res.json({
			success: true,
			period: { from: start, to: end },
			totalOrders: total,
			byStatus: stats.map(s => ({
				status: s._id,
				count: s.count,
				totalValue: s.totalValue,
				percentage: total > 0 ? ((s.count / total) * 100).toFixed(2) + "%" : "0%",
			})),
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

module.exports = {
	getOverview,
	getTransactions,
	getRevenueSummary,
	getPayouts,
	getProfitSummary,
	getOrderStats,
};
