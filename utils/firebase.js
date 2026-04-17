const admin = require("firebase-admin");
let serviceAccount;

function initFirebase() {
	try {
		if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
			serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
		} else {
			serviceAccount = require("../config/serviceAccountKey.json");
		}
		admin.initializeApp({
			credential: admin.credential.cert(serviceAccount),
		});
		console.log("✅ Firebase Admin Initialized");
	} catch (error) {
		console.warn(
			"⚠️ Firebase configuration missing or invalid. Push notifications will be disabled.",
		);
		console.warn("Firebase init error:", error.message);
	}
	return admin;
}

module.exports = initFirebase();
