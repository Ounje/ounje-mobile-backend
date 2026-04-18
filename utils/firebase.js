const admin = require("firebase-admin");
const logger = require("./logger");

function initFirebase() {
	try {
		let serviceAccount;

		if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
			serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
			if (serviceAccount.private_key) {
				serviceAccount.private_key = serviceAccount.private_key.replace(
					/\\n/g,
					"\n",
				);
			}
		} else {
			serviceAccount = require("../config/serviceAccountKey.json");
		}

		if (!admin.apps.length) {
			admin.initializeApp({
				credential: admin.credential.cert(serviceAccount),
			});
		}

		logger.info("✅ Firebase Admin Initialized");
	} catch (error) {
		logger.warn(
			"⚠️ Firebase configuration missing or invalid. Push notifications will be disabled.",
		);
		logger.warn(`Firebase init error: ${error.message}`);
	}
	return admin;
}

module.exports = initFirebase();
