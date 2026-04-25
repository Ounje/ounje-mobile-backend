const { GoogleAuth } = require("google-auth-library");
const fs = require("fs");
const logger = require("../utils/logger");

const PROJECT_ID = "ounje-market";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let _authClient = null;

async function getAccessToken() {
	if (!_authClient) {
		let authOptions;
		const secretPath = "/etc/secrets/.serviceAccountKey.json";

		if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
			const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
			if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
			authOptions = { credentials: sa, scopes: [FCM_SCOPE] };
		} else if (fs.existsSync(secretPath)) {
			authOptions = { keyFilename: secretPath, scopes: [FCM_SCOPE] };
		} else {
			authOptions = {
				keyFilename: require.resolve("../config/serviceAccountKey.json"),
				scopes: [FCM_SCOPE],
			};
		}

		const auth = new GoogleAuth(authOptions);
		_authClient = await auth.getClient();
	}

	const tokenObj = await _authClient.getAccessToken();
	return tokenObj.token;
}

const sendPushNotification = async (token, title, body, options = {}) => {
	try {
		if (!token) {
			logger.warn("Push skipped — no FCM token provided");
			return;
		}

		logger.info(
			`📱 Attempting push — token: ${token.slice(0, 20)}... | title: "${title}"`,
		);

		const accessToken = await getAccessToken();

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
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(message),
			},
		);

		const result = await response.json();

		if (!response.ok) {
			logger.error(
				`❌ FCM HTTP error ${response.status}: ${JSON.stringify(result)}`,
			);
			return;
		}

		logger.info(`✅ Push sent: "${title}" | messageId: ${result.name}`);
	} catch (error) {
		logger.error(`❌ Firebase push error: ${error.message}`);
	}
};

module.exports = {
	sendPushNotification,
};
