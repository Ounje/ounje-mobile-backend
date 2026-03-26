const notificationService = require("../services/notification.service");
const logger = require("../utils/logger");

class NotificationController {
	/**
	 * Resolve User._id → profile._id so notifications can be queried by recipient.
	 * Notifications are stored with VendorProfile._id / RiderProfile._id / Customer._id
	 * as the recipient — NOT the User._id that comes from the JWT.
	 */
	async _resolveProfileId(userId, role) {
		try {
			const { VendorProfile, RiderProfile, Customer } = require("../models");
			if (role === "vendor") {
				const p = await VendorProfile.findOne({ owner: userId }).select("_id").lean();
				return p?._id ?? null;
			}
			if (role === "rider") {
				const p = await RiderProfile.findOne({ user: userId }).select("_id").lean();
				return p?._id ?? null;
			}
			if (role === "customer") {
				const p = await Customer.findOne({ user: userId }).select("_id").lean();
				return p?._id ?? null;
			}
		} catch (err) {
			logger.error(`_resolveProfileId failed for userId=${userId} role=${role}: ${err.message}`);
		}
		return null;
	}

	async getNotifications(req, res) {
		try {
			const userId = req.user.id;
			const role = req.user.role || req.user.userType;
			const { page = 1, limit = 20, unreadOnly = false } = req.query;

			// Schema enum is lowercase: "vendor" | "customer" | "rider"
			const recipientModel = role;
			if (!["vendor", "customer", "rider"].includes(recipientModel)) {
				return res.status(400).json({ success: false, message: "Invalid user type" });
			}

			// Notifications are stored with the profile _id, not the User _id
			const profileId = await this._resolveProfileId(userId, role);
			if (!profileId) {
				return res.status(200).json({
					success: true,
					data: {
						notifications: [],
						pagination: { page: 1, limit: 20, total: 0, unreadCount: 0, hasMore: false },
					},
				});
			}

			const result = await notificationService.getUserNotifications(
				profileId,
				recipientModel,
				{
					page: parseInt(page),
					limit: parseInt(limit),
					unreadOnly: unreadOnly === "true",
				},
			);

			return res.status(200).json({ success: true, data: result });
		} catch (error) {
			logger.error("Get Notifications Error:", error);
			return res.status(500).json({
				success: false,
				message: "Error fetching notifications",
				error: error.message,
			});
		}
	}

	async getUnreadCount(req, res) {
		try {
			const userId = req.user.id;
			const role = req.user.role || req.user.userType;

			const profileId = await this._resolveProfileId(userId, role);
			const count = profileId ? await notificationService.getUnreadCount(profileId) : 0;

			return res.status(200).json({ success: true, data: { unreadCount: count } });
		} catch (error) {
			logger.error("Get Unread Count Error:", error);
			return res.status(500).json({
				success: false,
				message: "Error fetching unread count",
				error: error.message,
			});
		}
	}

	async getNotificationById(req, res) {
		try {
			const userId = req.user.id;
			const role = req.user.role || req.user.userType;
			const { notificationId } = req.params;
			const Notification = require("../models/Notification");

			const profileId = await this._resolveProfileId(userId, role);
			if (!profileId) {
				return res.status(404).json({ success: false, message: "Notification not found" });
			}

			const notification = await Notification.findOne({
				_id: notificationId,
				recipient: profileId,
			}).lean();

			if (!notification) {
				return res.status(404).json({ success: false, message: "Notification not found" });
			}

			return res.status(200).json({ success: true, data: notification });
		} catch (error) {
			logger.error("Get Notification By ID Error:", error);
			return res.status(500).json({
				success: false,
				message: "Error fetching notification",
				error: error.message,
			});
		}
	}

	async createNotification(req, res) {
		try {
			const { recipient, recipientModel, type, title, message, data, priority } = req.body;

			if (!recipient || !recipientModel || !type || !title || !message) {
				return res.status(400).json({
					success: false,
					message: "recipient, recipientModel, type, title, and message are required",
				});
			}

			const notification = await notificationService.createNotification({
				recipient,
				recipientModel,
				type,
				title,
				message,
				data: data || {},
				priority: priority || "medium",
			});

			return res.status(201).json({
				success: true,
				message: "Notification created",
				data: notification,
			});
		} catch (error) {
			logger.error("Create Notification Error:", error);
			return res.status(500).json({
				success: false,
				message: error.message || "Error creating notification",
			});
		}
	}

	async markAsRead(req, res) {
		try {
			const userId = req.user.id;
			const role = req.user.role || req.user.userType;
			const { notificationId } = req.params;

			const profileId = await this._resolveProfileId(userId, role);
			if (!profileId) {
				return res.status(404).json({ success: false, message: "Notification not found" });
			}

			const result = await notificationService.markAsRead(notificationId, profileId);

			return res.status(200).json({
				success: true,
				message: "Notification marked as read",
				data: result,
			});
		} catch (error) {
			logger.error("Mark As Read Error:", error);
			return res.status(500).json({
				success: false,
				message: error.message || "Error marking notification as read",
			});
		}
	}

	async markAllAsRead(req, res) {
		try {
			const userId = req.user.id;
			const role = req.user.role || req.user.userType;

			const profileId = await this._resolveProfileId(userId, role);
			const modifiedCount = profileId
				? await notificationService.markAllAsRead(profileId)
				: 0;

			return res.status(200).json({
				success: true,
				message: `${modifiedCount} notification(s) marked as read`,
				data: { modifiedCount },
			});
		} catch (error) {
			logger.error("Mark All As Read Error:", error);
			return res.status(500).json({
				success: false,
				message: "Error marking all notifications as read",
				error: error.message,
			});
		}
	}

	async deleteNotification(req, res) {
		try {
			const userId = req.user.id;
			const role = req.user.role || req.user.userType;
			const { notificationId } = req.params;

			const profileId = await this._resolveProfileId(userId, role);
			if (!profileId) {
				return res.status(404).json({ success: false, message: "Notification not found" });
			}

			await notificationService.deleteNotification(notificationId, profileId);

			return res.status(200).json({ success: true, message: "Notification deleted successfully" });
		} catch (error) {
			logger.error("Delete Notification Error:", error);
			return res.status(500).json({
				success: false,
				message: error.message || "Error deleting notification",
			});
		}
	}

	async deleteAllNotifications(req, res) {
		try {
			const userId = req.user.id;
			const role = req.user.role || req.user.userType;
			const Notification = require("../models/Notification");

			const profileId = await this._resolveProfileId(userId, role);
			if (!profileId) {
				return res.status(200).json({ success: true, data: { deletedCount: 0 } });
			}

			const { deletedCount } = await Notification.deleteMany({ recipient: profileId });

			return res.status(200).json({
				success: true,
				message: `${deletedCount} notification(s) deleted`,
				data: { deletedCount },
			});
		} catch (error) {
			logger.error("Delete All Notifications Error:", error);
			return res.status(500).json({
				success: false,
				message: "Error deleting all notifications",
				error: error.message,
			});
		}
	}
}

module.exports = new NotificationController();
