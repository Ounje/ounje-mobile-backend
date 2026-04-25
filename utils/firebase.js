const admin = require("firebase-admin");
const fs = require("fs");
const logger = require("./logger");

function initFirebase() {
	try {
		let serviceAccount;

		const secretPath = "/etc/secrets/.serviceAccountKey.json";

		if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
			logger.info("🔑 Firebase: loading from env var");
			serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
			if (serviceAccount.private_key) {
				serviceAccount.private_key = serviceAccount.private_key
					.replace(/\\\\n/g, "\n")
					.replace(/\\n/g, "\n");
			}
		} else if (fs.existsSync(secretPath)) {
			logger.info("🔑 Firebase: loading from secret file");
			if (!admin.apps.length) {
				admin.initializeApp({ credential: admin.credential.cert(secretPath) });
			}
			logger.info("✅ Firebase Admin Initialized");
			return admin;
		} else {
			logger.info("🔑 Firebase: loading from local config");
			serviceAccount = require("../config/serviceAccountKey.json");
		}

		if (!admin.apps.length) {
			admin.initializeApp({
				credential: admin.credential.cert(serviceAccount),
			});
		}

		logger.info("✅ Firebase Admin Initialized");
	} catch (error) {
		logger.warn("⚠️ Firebase configuration missing or invalid. Push notifications will be disabled.");
		logger.warn(`Firebase init error: ${error.message}`);
	}
	return admin;
}

module.exports = initFirebase();
