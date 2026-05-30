const { Order, Payment } = require("../models");
const ledgerService = require("../services/ledger.service");
const notificationService = require("../services/notification.service");
const { refundTransaction } = require("../services/dva.service");
const logger = require("../utils/logger");

const processAutoCancelOrders = async () => {
	// Find orders that are in "confirming" status, still pending vendor acceptance, and were created more than 10 minutes ago
	const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

	const staleOrders = await Order.find({
		status: "confirming",
		subStatus: "confirming",
		createdAt: { $lte: tenMinutesAgo },
	});

	if (staleOrders.length === 0) return;

	logger.info(`[CRON] autoCancelProcessor — found ${staleOrders.length} stale orders`);

	for (const order of staleOrders) {
		try {
			logger.info(`[CRON] Cancelling stale order: ${order._id}`);

			// Atomically transition the order to cancelled only if it is still confirming
			const updatedOrder = await Order.findOneAndUpdate(
				{ _id: order._id, status: "confirming", subStatus: "confirming" },
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
					// Atomically transition paymentStatus from paid to refunded to prevent double refund
					const refundedOrder = await Order.findOneAndUpdate(
						{ _id: updatedOrder._id, paymentStatus: "paid" },
						{ $set: { paymentStatus: "refunded" } },
						{ new: true }
					);
					if (refundedOrder) {
						const originalPaymentMethod = updatedOrder.paymentMethod || "paystack";
						await ledgerService.creditAccount(
							updatedOrder.customer,
							"CUSTOMER",
							updatedOrder.totalPrice,
							"REFUND",
							updatedOrder._id,
							{ reason: "vendor_unresponsive_auto_cancel", originalPaymentMethod },
						);
						logger.info(`[REFUND] Auto refund issued to O-Credit wallet for order ${updatedOrder._id}`);
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

			// 3. Send Push & Database/Realtime Notifications
			// Customer Notification
			try {
				await notificationService.createNotification({
					recipient: updatedOrder.customer,
					recipientModel: "customer",
					type: "order_cancelled",
					title: "Order Cancelled",
					message: "The vendor was unresponsive, so your order has been automatically cancelled and a refund initiated.",
					channelId: "general",
				});
			} catch (err) {
				logger.error(`Failed to notify customer for auto-cancel: ${err.message}`);
			}

			// Vendor Notification
			try {
				await notificationService.createNotification({
					recipient: updatedOrder.vendor,
					recipientModel: "vendor",
					type: "order_cancelled",
					title: "Missed Order",
					message: "An order was automatically cancelled because it wasn't accepted within 10 minutes.",
					channelId: "general",
				});
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
