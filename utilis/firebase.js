const admin = require("firebase-admin");
let serviceAccount;

function initFirebase() {
	try {
		serviceAccount = require("../config/serviceAccountKey.json");
		admin.initializeApp({
			credential: admin.credential.cert(serviceAccount),
		});
		console.log("✅ Firebase Admin Initialized");
	} catch (error) {
		console.warn(
			"⚠️ Firebase configuration missing or invalid. Push notifications will be disabled.",
		);
	}
	return admin;
}

module.exports = initFirebase();
