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
		if (!token) return;

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
		logger.info(`✅ Push notification sent via Firebase: ${title}`);
	} catch (error) {
		logger.error(`❌ Firebase push error: ${error.message}`);
	}
};

module.exports = {
	sendPushNotification,
};
