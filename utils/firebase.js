const admin = require("firebase-admin");
const fs = require("fs");
const logger = require("./logger");

function parsePrivateKey(key) {
	if (!key) return key;
	// Handle all common escaping variants from env vars / JSON stringification
	return key.replace(/\\n/g, "\n");
}

function initFirebase() {
	if (admin.apps.length) return admin;

	try {
		const secretPath = "/etc/secrets/.serviceAccountKey.json";
		let credential;

		if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
			logger.info("🔑 Firebase: loading from env var");
			const serviceAccount = JSON.parse(
				process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
			);
			serviceAccount.private_key = parsePrivateKey(serviceAccount.private_key);

			logger.info(`🔑 project_id: ${serviceAccount.project_id}`);
			logger.info(`🔑 client_email: ${serviceAccount.client_email}`);
			logger.info(
				`🔑 private_key[:50]: ${serviceAccount.private_key?.slice(0, 50)}`,
			);
			logger.info(
				`🔑 private_key[-30:]: ${serviceAccount.private_key?.slice(-30)}`,
			);

			credential = admin.credential.cert(serviceAccount);
		} else if (fs.existsSync(secretPath)) {
			logger.info("🔑 Firebase: loading from secret file");
			credential = admin.credential.cert(secretPath);
		} else {
			logger.info("🔑 Firebase: loading from local config");
			const serviceAccount = require("../config/serviceAccountKey.json");
			credential = admin.credential.cert(serviceAccount);
		}

		admin.initializeApp({ credential });
		logger.info("✅ Firebase Admin Initialized");

		// Eagerly verify the credential works
		admin
			.app()
			.options.credential.getAccessToken()
			.then((t) =>
				logger.info(`✅ OAuth2 token OK: ${t.access_token.slice(0, 20)}...`),
			)
			.catch((e) => logger.error(`❌ OAuth2 token FAILED: ${e.message}`));
	} catch (error) {
		logger.warn("⚠️ Firebase init failed — push notifications disabled");
		logger.warn(`Firebase init error: ${error.message}`);
	}

	return admin;
}

module.exports = initFirebase();
