const firebaseAdmin = require("../utils/firebase");
/**
 * @param {string} token - The user's unique device token
 * @param {string} title - The heading (e.g., "Order Packaged!")
 * @param {string} body - The detail (e.g., "The vendor is done with your meal")
 */
const sendPushNotification = async (token, title, body) => {
	try {
		if (!token) return; // Can't send if we don't have a device to send to

		const message = {
			notification: { title, body },
			token: token, // This is the specific phone's ID
		};

		if (!firebaseAdmin.apps?.length) {
			console.log("⚠️ Push skipped (Firebase not configured):", title);
			return;
		}

		await firebaseAdmin.messaging().send(message);
		console.log("✅ Push Notification sent!");
	} catch (error) {
		console.error("❌ Firebase error:", error);
	}
};

module.exports = {
	sendPushNotification,
};
