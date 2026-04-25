const admin = require("../utils/firebase");
const logger = require("../utils/logger");

const PROJECT_ID = "ounje-market";

/**
 * Send push notification via FCM HTTP v1 API using the service account credential directly.
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

		if (!admin.apps.length) {
			logger.warn("⚠️ Firebase Admin not initialized — push skipped");
			return;
		}

		// Get OAuth2 access token directly from the app credential
		const accessTokenObj = await admin.app().options.credential.getAccessToken();
		const accessToken = accessTokenObj.access_token;

		// FCM requires all data values to be strings
		const dataPayload = {};
		if (options.data) {
			for (const [k, v] of Object.entries(options.data)) {
				dataPayload[k] = String(v);
			}
		}

		const message = {
			message: {
				token,
				notification: { title, body },
				android: {
					priority: "high",
					notification: {
						channel_id: options.channelId ?? "orders",
						notification_priority: "PRIORITY_HIGH",
						default_sound: true,
					},
				},
				apns: {
					payload: {
						aps: { sound: "default", badge: 1 },
					},
				},
				...(Object.keys(dataPayload).length > 0 && { data: dataPayload }),
			},
		};

		const response = await fetch(
			`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
			{
				method: "POST",
				headers: {
					"Authorization": `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(message),
			},
		);

		const result = await response.json();

		if (!response.ok) {
			logger.error(`❌ FCM HTTP error ${response.status}: ${JSON.stringify(result)}`);
			return;
		}

		logger.info(`✅ Push notification sent via FCM v1: "${title}" | messageId: ${result.name}`);
	} catch (error) {
		logger.error(`❌ Firebase push error: ${error.message} | token: ${token?.slice(0, 20)}...`);
	}
};

module.exports = {
	sendPushNotification,
};
