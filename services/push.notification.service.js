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

		// "orders" is the legacy channel id — map it to the current v8 channel
		// so both old callers (channelId:"orders") and new ones work correctly.
		const rawChannel = options.channelId ?? "general";
		const resolvedChannelId = rawChannel === "orders" ? "orders_v8" : rawChannel;
		const isOrderAlert = resolvedChannelId === "orders_v8";
		const soundName = isOrderAlert ? "new_alert" : "default";
		const iosSoundName = isOrderAlert ? "new_alert.wav" : "default";


		// For order alerts: send a DATA-ONLY message so the app's background
		// message handler fires and schedules a local notification using the
		// orders_v8 channel (which has the custom sound). If we include a
		// `notification` payload, Android auto-displays it without going through
		// our handler, bypassing the custom sound entirely.
		//
		// For all other notifications: keep the notification payload so Android
		// auto-displays them normally even if the app is fully killed.
		const message = isOrderAlert
			? {
					token,
					// data-only — no `notification` key
					android: { priority: "high" },
					apns: {
						headers: { "apns-priority": "10" },
						payload: { aps: { "content-available": 1 } },
					},
					data: {
						...dataPayload,
						title: String(title),
						body: String(body),
						channelId: resolvedChannelId,
						sound: soundName,
					},
			  }
			: {
					token,
					notification: { title, body },
					android: {
						priority: "high",
						notification: {
							channelId: resolvedChannelId,
							priority: "high",
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
