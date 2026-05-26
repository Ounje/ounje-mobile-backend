const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const notificationController = require("../controllers/notificationController");

/**
 * @route   GET /api/notifications
 * @desc    Get all notifications for the authenticated user (paginated)
 * @access  Private (Vendor, Customer, Rider)
 */
router.get(
	"/",
	authMiddleware,
	notificationController.getNotifications.bind(notificationController),
);

/**
 * @route   POST /api/notifications
 * @desc    Create and broadcast a notification
 * @access  Private
 */
router.post(
	"/",
	authMiddleware,
	notificationController.createNotification.bind(notificationController),
);

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get count of unread notifications
 * @access  Private (Vendor, Customer, Rider)
 */
router.get(
	"/unread-count",
	authMiddleware,
	notificationController.getUnreadCount.bind(notificationController),
);

/**
 * @route   PATCH /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private (Vendor, Customer, Rider)
 */
router.patch(
	"/read-all",
	authMiddleware,
	notificationController.markAllAsRead.bind(notificationController),
);

/**
 * @route   DELETE /api/notifications/delete-all
 * @desc    Delete all notifications for the authenticated user
 * @access  Private (Vendor, Customer, Rider)
 */
router.delete(
	"/delete-all",
	authMiddleware,
	notificationController.deleteAllNotifications.bind(notificationController),
);

/**
 * @route   GET /api/notifications/:notificationId
 * @desc    Get a specific notification by ID
 * @access  Private (Vendor, Customer, Rider)
 */
router.get(
	"/:notificationId",
	authMiddleware,
	notificationController.getNotificationById.bind(notificationController),
);

/**
 * @route   PATCH /api/notifications/:notificationId/read
 * @route   PUT   /api/notifications/:notificationId/read
 * @desc    Mark a specific notification as read
 * @access  Private (Vendor, Customer, Rider)
 */
router.patch(
	"/:notificationId/read",
	authMiddleware,
	notificationController.markAsRead.bind(notificationController),
);
router.put(
	"/:notificationId/read",
	authMiddleware,
	notificationController.markAsRead.bind(notificationController),
);

/**
 * @route   DELETE /api/notifications/:notificationId
 * @desc    Delete a specific notification
 * @access  Private (Vendor, Customer, Rider)
 */
router.delete(
	"/:notificationId",
	authMiddleware,
	notificationController.deleteNotification.bind(notificationController),
);

module.exports = router;
