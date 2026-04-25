const Notification = require("../models/Notification");
const {
	sendPushNotification,
} = require("../services/push.notification.service");
const logger = require("../utils/logger");

class NotificationService {
	async createNotification(payload) {
		try {
			const notification = await Notification.create(payload);
			this.emitRealtime(payload.recipient, notification);
			await this.pushToUser(
				payload.recipient,
				payload.recipientModel,
				payload.title,
				payload.message,
			);
			return notification;
		} catch (error) {
			logger.error(`Failed to create notification: ${error.message}`);
			throw error;
		}
	}

	// NEW: Works for all user types (vendor, customer, rider)
	async getUserNotifications(
		userId,
		recipientModel,
		{ page = 1, limit = 20, unreadOnly = false },
	) {
		const skip = (page - 1) * limit;
		const query = { recipient: userId, recipientModel: recipientModel };
		if (unreadOnly) query.isRead = false;

		const [notifications, total, unreadCount] = await Promise.all([
			Notification.find(query)
				.sort("-createdAt")
				.skip(skip)
				.limit(limit)
				.lean(),
			Notification.countDocuments(query),
			Notification.countDocuments({ recipient: userId, isRead: false }),
		]);

		return {
			notifications,
			pagination: {
				page,
				limit,
				total,
				unreadCount,
				hasMore: page * limit < total,
			},
		};
	}

	// DEPRECATED: Use getUserNotifications instead
	// Keeping for backward compatibility
	async getVendorNotifications(
		vendorId,
		{ page = 1, limit = 20, unreadOnly = false },
	) {
		return this.getUserNotifications(vendorId, "Vendor", {
			page,
			limit,
			unreadOnly,
		});
	}

	async markAsRead(notificationId, userId) {
		const notification = await Notification.findOneAndUpdate(
			{ _id: notificationId, recipient: userId },
			{ isRead: true },
			{ new: true },
		);
		if (!notification) throw new Error("Notification not found");
		this.emitSocket(userId, "notification_read", { notificationId });
		return notification;
	}

	async markAllAsRead(userId) {
		const { modifiedCount } = await Notification.updateMany(
			{ recipient: userId, isRead: false },
			{ isRead: true },
		);
		this.emitSocket(userId, "all_notifications_read", {});
		return modifiedCount;
	}

	async deleteNotification(notificationId, userId) {
		const deleted = await Notification.findOneAndDelete({
			_id: notificationId,
			recipient: userId,
		});
		if (!deleted) throw new Error("Notification not found");
	}

	async getUnreadCount(userId) {
		return Notification.countDocuments({ recipient: userId, isRead: false });
	}

	// ============ VENDOR NOTIFICATIONS ============

	async notifyNewOrder(vendorId, order) {
		const earning = order.vendorEarning ?? order.totalPrice;
		return this.createNotification({
			recipient: vendorId,
			recipientModel: "vendor",
			type: "new_order",
			title: "🎉 New Order Received!",
			message: `You have a new order worth ₦${earning.toLocaleString()} (your earnings)`,
			data: {
				orderId: order._id,
				vendorEarning: earning,
				itemCount: order.items?.length || 0,
			},
			priority: "high",
		});
	}

	async notifyOrderCancelled(vendorId, order) {
		const earning = order.vendorEarning ?? order.totalPrice;
		return this.createNotification({
			recipient: vendorId,
			recipientModel: "vendor",
			type: "order_cancelled",
			title: "Order Cancelled",
			message: `Order worth ₦${earning.toLocaleString()} (your earnings) has been cancelled`,
			data: { orderId: order._id },
		});
	}

	async notifyPayoutCompleted(vendorId, payout) {
		return this.createNotification({
			recipient: vendorId,
			recipientModel: "vendor",
			type: "payout_completed",
			title: "💰 Payout Successful!",
			message: `Your payout of ₦${payout.amount} has been sent`,
			data: { payoutId: payout._id },
			priority: "high",
		});
	}

	async notifyPayoutFailed(vendorId, payout) {
		return this.createNotification({
			recipient: vendorId,
			recipientModel: "vendor",
			type: "payout_failed",
			title: "⚠️ Payout Failed",
			message: `Your payout of ₦${payout.amount} failed. Please check your account details.`,
			data: { payoutId: payout._id },
			priority: "urgent",
		});
	}

	async notifyNewsFlash(vendorId, newsflash) {
		return this.createNotification({
			recipient: vendorId,
			recipientModel: "vendor",
			type: "newsflash",
			title: newsflash.title || "📢 New Announcement",
			message: newsflash.description || "Check out the latest newsflash",
			data: {
				newsflashId: newsflash._id,
				imageUrl: newsflash.imageUrl,
			},
			priority: "medium",
		});
	}

	// ============ CUSTOMER NOTIFICATIONS ============

	async notifyCustomerRiderAssigned(customerId, order, riderName) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "new_order",
			title: "🚴 Rider Assigned!",
			message: `${riderName} is on the way to pick up your order`,
			data: {
				orderId: order._id,
				riderId: order.rider,
			},
			priority: "high",
		});
	}
	async notifyCustomerFoodReady(customerId, order) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "food_ready",
			title: "🍽️ Food Ready for Pickup!",
			message: "Your food is ready and waiting for the rider to pick it up",
			data: { orderId: order._id },
			priority: "high",
		});
	}

	async notifyCustomerOrderAccepted(customerId, order, vendorName) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "vendor_accepted_order",
			title: "Vendor has accepted your order!",
			message: `${vendorName} has accepted your order`,
			data: {
				orderId: order._id,
				vendorId: order.vendor,
			},
			priority: "high",
		});
	}
	async notifyCustomerOrderDeclined(customerId, order, vendorName) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "vendor_declined_order",
			title: "Vendor has declined your order!",
			message: `${vendorName} declined your order`,
			data: {
				orderId: order._id,
				vendorId: order.vendor,
			},
			priority: "high",
		});
	}

	async notifyCustomerOrderPickedUp(customerId, order) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "new_order",
			title: "📦 Order Picked Up!",
			message: "Your rider has picked up your order and is heading your way",
			data: { orderId: order._id },
			priority: "high",
		});
	}

	async notifyCustomerDeliveryComplete(customerId, order) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "new_order",
			title: "✅ Order Delivered!",
			message: "Your order has been delivered. Enjoy your meal!",
			data: { orderId: order._id },
			priority: "high",
		});
	}
	async notifyCustomerRiderDeclined(customerId, order) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "rider_declined_order",
			title: "🚴 Rider Declined Order",
			message: "Your order has been declined by the assigned rider",
			data: { orderId: order._id },
			priority: "high",
		});
	}

	async notifyCustomerWalletTopup(customerId, amountNaira) {
		return this.createNotification({
			recipient: customerId,
			recipientModel: "customer",
			type: "wallet_topup",
			title: "💰 Wallet Credited!",
			message: `₦${Number(amountNaira).toLocaleString()} has been added to your O-Credit wallet`,
			data: { amount: amountNaira },
			priority: "high",
		});
	}

	// ============ RIDER NOTIFICATIONS ============

	async notifyRiderOrderAvailable(riderId, order) {
		return this.createNotification({
			recipient: riderId,
			recipientModel: "rider",
			type: "new_order",
			title: "🛵 New Delivery Request",
			message: `Delivery fee: ₦${order.deliveryFee}`,
			data: {
				orderId: order._id,
				deliveryFee: order.deliveryFee,
				zone: order.zone,
			},
			priority: "high",
		});
	}

	// ============ HELPER METHODS ============

	emitRealtime(recipient, notification) {
		this.emitSocket(recipient, "new_notification", {
			notification: notification.toObject
				? notification.toObject()
				: notification,
			timestamp: Date.now(),
		});
	}

	emitSocket(userId, event, payload) {
		if (global.io) {
			global.io.to(userId.toString()).emit(event, payload);
		}
	}

	async pushToUser(profileId, recipientModel, title, body) {
		try {
			const User = require("../models/User");
			let user = null;

			if (recipientModel === "vendor") {
				const { VendorProfile } = require("../models");
				const profile = await VendorProfile.findById(profileId).select("owner");
				if (profile?.owner)
					user = await User.findById(profile.owner).select("fcmToken");
			} else if (recipientModel === "rider") {
				const { RiderProfile } = require("../models");
				const profile = await RiderProfile.findById(profileId).select("user");
				if (profile?.user)
					user = await User.findById(profile.user).select("fcmToken");
			} else {
				const { Customer } = require("../models");
				const profile = await Customer.findById(profileId).select("user");
				if (profile?.user)
					user = await User.findById(profile.user).select("fcmToken");
			}

			if (!user) {
				logger.warn(`User not found for ${recipientModel} profile ${profileId}`);
				return;
			}

			if (!user.fcmToken) {
				logger.info(`No push token for ${recipientModel} ${profileId}`);
				return;
			}

			await sendPushNotification(user.fcmToken, title, body, { channelId: "orders" });
			logger.info(`Push notification sent to ${recipientModel} ${profileId}: ${title}`);
		} catch (error) {
			logger.error(`Failed to send push notification to ${profileId}: ${error.message}`);
		}
	}
}

module.exports = new NotificationService();
