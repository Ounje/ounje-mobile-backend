const { Order, Payment } = require("../models");
const ledgerService = require("../services/ledger.service");
const notificationService = require("../services/notification.service");
const { refundTransaction } = require("../services/dva.service");
const logger = require("../utils/logger");

const processAutoCancelOrders = async () => {
	// Find orders that are in "confirming" status and were created more than 5 minutes ago
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

	const staleOrders = await Order.find({
		status: "confirming",
		createdAt: { $lte: fiveMinutesAgo },
	});

	if (staleOrders.length === 0) return;

	logger.info(`[CRON] autoCancelProcessor — found ${staleOrders.length} stale orders`);

	for (const order of staleOrders) {
		try {
			logger.info(`[CRON] Cancelling stale order: ${order._id}`);

			order.status = "cancelled";
			order.subStatus = "cancelled";
			order.cancelledAt = new Date();
			order.cancellationCategory = "system";

			await order.save();

			// 1. Process Refund
			if (order.paymentStatus === "paid") {
				try {
					if (order.paymentMethod === "wallet") {
						await ledgerService.creditAccount(
							order.customer,
							"CUSTOMER",
							order.totalPrice,
							"REFUND",
							order._id,
							{ reason: "vendor_unresponsive_auto_cancel" },
						);
						order.paymentStatus = "refunded";
						await order.save();
					} else if (order.paymentMethod === "paystack") {
						const payment = await Payment.findOne({
							orderId: order._id,
							status: "success",
						});
						if (payment) {
							await refundTransaction(payment.reference, order.totalPrice * 100);
							order.paymentStatus = "refunded";
							await order.save();
							logger.info(`[REFUND] Auto Paystack refund issued for order ${order._id}`);
						}
					}
				} catch (error) {
					logger.error(
						`Failed to refund customer for auto-cancelled order ${order._id}: ${error.message}`,
					);
				}
			}

			// 2. Reverse Ledger Earnings
			try {
				await ledgerService.reverseOrderEarnings(order);
			} catch (error) {
				logger.error(
					`Failed to reverse ledger for auto-cancelled order ${order._id}: ${error.message}`,
				);
			}

			// 3. Send Push Notifications
			// Customer Notification
			try {
				await notificationService.pushToUser(
					order.customer,
					"customer",
					"Order Cancelled",
					"The vendor was unresponsive, so your order has been automatically cancelled and a refund initiated.",
					"orders"
				);
			} catch (err) {
				logger.error(`Failed to notify customer for auto-cancel: ${err.message}`);
			}

			// Vendor Notification
			try {
				await notificationService.pushToUser(
					order.vendor,
					"vendor",
					"Missed Order",
					"An order was automatically cancelled because it wasn't accepted within 5 minutes.",
					"orders"
				);
			} catch (err) {
				logger.error(`Failed to notify vendor for auto-cancel: ${err.message}`);
			}

			// 4. Emit Socket Events for UI update
			if (global.io) {
				global.io.to(order.customer.toString()).emit("orderCancelled", {
					orderId: order._id,
					message: "Order cancelled automatically due to vendor unresponsiveness.",
				});
				global.io.to(order.vendor.toString()).emit("orderCancelled", {
					orderId: order._id,
					message: "Order cancelled because it was not accepted in time.",
				});
			}

		} catch (err) {
			logger.error(`[CRON] autoCancelProcessor error on order ${order._id}: ${err.message}`);
		}
	}
};

module.exports = {
	processAutoCancelOrders,
};
