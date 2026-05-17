const admin = require("../utils/firebase");
const logger = require("../utils/logger");

const sendPushNotification = async (token, title, body, options = {}) => {
	try {
		if (!token) {
			logger.warn("⚠️ Push skipped — no FCM token provided");
			return;
		}

		if (!admin.apps.length) {
			logger.warn("⚠️ Firebase Admin not initialized — push skipped");
			return;
		}

		logger.info(
			`📱 Attempting push — token: ${token.slice(0, 20)}... | title: "${title}"`,
		);

		const dataPayload = {};
		if (options.data) {
			for (const [k, v] of Object.entries(options.data)) {
				dataPayload[k] = String(v);
			}
		}

		const isOrderAlert = options.channelId === "orders";
		const soundName = isOrderAlert ? "order_alert" : "default";
		const iosSoundName = isOrderAlert ? "order_alert.mp3" : "default";

		const message = {
			token,
			notification: { title, body },
			android: {
				priority: "high",
				notification: {
					channelId: options.channelId ?? "general",
					priority: "high",
					defaultSound: !isOrderAlert,
					...(isOrderAlert && { sound: soundName }),
				},
			},
			apns: {
				payload: {
					aps: { sound: iosSoundName, badge: 1 },
				},
			},
			...(Object.keys(dataPayload).length > 0 && { data: dataPayload }),
		};

		const messageId = await admin.messaging().send(message);
		logger.info(`✅ Push sent: "${title}" | messageId: ${messageId}`);
	} catch (error) {
		logger.error(
			`❌ Firebase push error: ${error.message} | token: ${token?.slice(0, 20)}...`,
		);
	}
};

module.exports = { sendPushNotification };
