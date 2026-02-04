const notificationService = require("../services/notification.service");
const logger = require("../utilis/logger");

class NotificationController {
	async getNotifications(req, res) {
		try {
			const userId = req.user.id;
			const userType = req.user.role || req.user.userType; // Get from auth middleware
			const { page = 1, limit = 20, unreadOnly = false } = req.query;

			// Determine recipient model based on user type
			let recipientModel;
			if (userType === "Vendor" || req.user.__t === "Vendor") {
				recipientModel = "Vendor";
			} else if (userType === "customer" || req.user.__t === "customer") {
				recipientModel = "Customer";
			} else if (userType === "rider" || req.user.__t === "rider") {
				recipientModel = "Rider";
			} else {
				return res.status(400).json({
					success: false,
					message: "Invalid user type",
				});
			}

			const result = await notificationService.getUserNotifications(
				userId,
				recipientModel,
				{
					page: parseInt(page),
					limit: parseInt(limit),
					unreadOnly: unreadOnly === "true",
				},
			);
			console.log(`Notification Result for ${recipientModel} user:`, result);
			return res.status(200).json({
				success: true,

				data: result,
			});
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
			const count = await notificationService.getUnreadCount(userId);

			return res.status(200).json({
				success: true,
				data: {
					unreadCount: count,
				},
			});
		} catch (error) {
			logger.error("Get Unread Count Error:", error);
			return res.status(500).json({
				success: false,
				message: "Error fetching unread count",
				error: error.message,
			});
		}
	}

	async markAsRead(req, res) {
		try {
			const userId = req.user.id;
			const { notificationId } = req.params;

			const result = await notificationService.markAsRead(
				notificationId,
				userId,
			);

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
			const modifiedCount = await notificationService.markAllAsRead(userId);

			return res.status(200).json({
				success: true,
				message: `${modifiedCount} notification(s) marked as read`,
				data: {
					modifiedCount,
				},
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
			const { notificationId } = req.params;

			await notificationService.deleteNotification(notificationId, userId);

			return res.status(200).json({
				success: true,
				message: "Notification deleted successfully",
			});
		} catch (error) {
			logger.error("Delete Notification Error:", error);
			return res.status(500).json({
				success: false,
				message: error.message || "Error deleting notification",
			});
		}
	}
}

module.exports = new NotificationController();
