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

			// Atomically transition the order to cancelled only if it is still confirming
			const updatedOrder = await Order.findOneAndUpdate(
				{ _id: order._id, status: "confirming" },
				{
					$set: {
						status: "cancelled",
						subStatus: "cancelled",
						cancelledAt: new Date(),
						cancellationCategory: "system",
					}
				},
				{ new: true }
			);

			if (!updatedOrder) {
				logger.info(`[CRON] Order ${order._id} was already updated/cancelled by another process. Skipping.`);
				continue;
			}

			// 1. Process Refund
			if (updatedOrder.paymentStatus === "paid") {
				try {
					if (updatedOrder.paymentMethod === "wallet") {
						// Atomically transition paymentStatus from paid to refunded to prevent double refund
						const refundedOrder = await Order.findOneAndUpdate(
							{ _id: updatedOrder._id, paymentStatus: "paid" },
							{ $set: { paymentStatus: "refunded" } },
							{ new: true }
						);
						if (refundedOrder) {
							await ledgerService.creditAccount(
								updatedOrder.customer,
								"CUSTOMER",
								updatedOrder.totalPrice,
								"REFUND",
								updatedOrder._id,
								{ reason: "vendor_unresponsive_auto_cancel" },
							);
							logger.info(`[REFUND] Auto Wallet refund issued for order ${updatedOrder._id}`);
						}
					} else if (updatedOrder.paymentMethod === "paystack") {
						const payment = await Payment.findOne({
							orderId: updatedOrder._id,
							status: "success",
						});
						if (payment) {
							// Atomically transition paymentStatus from paid to refunded to prevent double refund
							const refundedOrder = await Order.findOneAndUpdate(
								{ _id: updatedOrder._id, paymentStatus: "paid" },
								{ $set: { paymentStatus: "refunded" } },
								{ new: true }
							);
							if (refundedOrder) {
								await refundTransaction(payment.reference, updatedOrder.totalPrice * 100);
								logger.info(`[REFUND] Auto Paystack refund issued for order ${updatedOrder._id}`);
							}
						}
					}
				} catch (error) {
					logger.error(
						`Failed to refund customer for auto-cancelled order ${updatedOrder._id}: ${error.message}`,
					);
				}
			}

			// 2. Reverse Ledger Earnings
			try {
				await ledgerService.reverseOrderEarnings(updatedOrder);
			} catch (error) {
				logger.error(
					`Failed to reverse ledger for auto-cancelled order ${updatedOrder._id}: ${error.message}`,
				);
			}

			// 3. Send Push Notifications
			// Customer Notification
			try {
				await notificationService.pushToUser(
					updatedOrder.customer,
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
					updatedOrder.vendor,
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
				global.io.to(updatedOrder.customer.toString()).emit("orderUpdate", {
					orderId: updatedOrder._id,
					status: updatedOrder.status,
					subStatus: updatedOrder.subStatus,
					message: "Order cancelled automatically due to vendor unresponsiveness.",
				});
				global.io.to(updatedOrder.vendor.toString()).emit("orderUpdate", {
					orderId: updatedOrder._id,
					status: updatedOrder.status,
					subStatus: updatedOrder.subStatus,
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
