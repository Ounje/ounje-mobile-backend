const admin = require("../utils/firebase");
const logger = require("../utils/logger");

/**
 * Send push notification via Firebase Admin SDK (FCM).
 * Accepts raw FCM tokens registered by the mobile app via @react-native-firebase/messaging.
 *
 * @param {string} token     - FCM device token
 * @param {string} title     - Notification title
 * @param {string} body      - Notification body
 * @param {object} [options] - Extra options: { channelId, data }
 */
const sendPushNotification = async (token, title, body, options = {}) => {
	try {
		if (!token) {
			logger.warn("⚠️ Push skipped — no FCM token provided");
			return;
		}

		logger.info(
			`📱 Attempting push — token: ${token.slice(0, 20)}... | title: "${title}"`,
		);

		const messaging = admin.messaging?.();
		if (!messaging) {
			logger.warn("⚠️ Firebase Admin not initialized — push skipped");
			return;
		}

		// FCM requires all data values to be strings
		const dataPayload = {};
		if (options.data) {
			for (const [k, v] of Object.entries(options.data)) {
				dataPayload[k] = String(v);
			}
		}

		const message = {
			token,
			notification: { title, body },
			android: {
				priority: "high",
				notification: {
					channelId: options.channelId ?? "orders",
					priority: "high",
					defaultSound: true,
				},
			},
			apns: {
				payload: {
					aps: { sound: "default", badge: 1 },
				},
			},
			...(Object.keys(dataPayload).length > 0 && { data: dataPayload }),
		};

		await messaging.send(message);
		logger.info(`✅ Push notification sent via Firebase: "${title}"`);
	} catch (error) {
		// Token is invalid or expired — log the token so it can be identified and cleared
		if (
			error.code === "messaging/invalid-registration-token" ||
			error.code === "messaging/registration-token-not-registered"
		) {
			logger.warn(
				`⚠️ Stale or invalid FCM token (first 20): ${token?.slice(0, 20)}... — device may need to re-register`,
			);
			return;
		}

		logger.error(
			`❌ Firebase push error: ${error.message} | token: ${token?.slice(0, 20)}...`,
		);
	}
};

module.exports = {
	sendPushNotification,
};
