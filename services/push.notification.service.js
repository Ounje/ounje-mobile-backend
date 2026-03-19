const axios = require("axios");

/**
 * Send push notification via Expo Push API.
 * Accepts Expo push tokens (ExponentPushToken[xxx]) registered by the mobile app.
 *
 * @param {string} token     - Expo push token
 * @param {string} title     - Notification title
 * @param {string} body      - Notification body
 * @param {object} [options] - Extra options: { channelId, data }
 */
const sendPushNotification = async (token, title, body, options = {}) => {
	try {
		if (!token) return;

		// Only send to valid Expo push tokens
		if (!token.startsWith("ExponentPushToken") && !token.startsWith("ExpoPushToken")) {
			console.log("⚠️ Push skipped: not an Expo push token:", token.slice(0, 20));
			return;
		}

		const response = await axios.post(
			"https://exp.host/--/api/v2/push/send",
			{
				to: token,
				title,
				body,
				sound: "default",
				priority: "high",
				// Route to the high-importance Android channel defined in the app
				channelId: options.channelId ?? "orders",
				...(options.data && { data: options.data }),
			},
			{
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
			},
		);

		const result = response.data?.data;
		if (result?.status === "error") {
			console.error("❌ Expo push error:", result.message);
		} else {
			console.log("✅ Push notification sent via Expo:", title);
		}
	} catch (error) {
		console.error("❌ Expo push error:", error.message);
	}
};

module.exports = {
	sendPushNotification,
};
