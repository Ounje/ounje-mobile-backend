const riderService = require("../services/rider.service");
const ledgerService = require("../services/ledger.service");
const logger = require("../utils/logger");
const RiderProfile = require("../models/RiderProfile");

/**
 * Get Rider Wallet/Dashboard
 * GET /api/riders/wallet
 */
const getRiderWallet = async (req, res) => {
	try {
		const riderProfile = await RiderProfile.findOne({
			user: req.user.id,
		}).select("_id");
		if (!riderProfile) {
			return res
				.status(404)
				.json({ success: false, message: "Rider profile not found" });
		}
		const riderId = riderProfile._id;

		const [balance, todayEarnings, { transactions }] = await Promise.all([
			ledgerService.getAccountBalance(riderId, "RIDER"),
			ledgerService.getDailyEarnings(riderId, "RIDER"),
			ledgerService.getTransactionHistory(riderId, "RIDER", 20, 0),
		]);

		res.status(200).json({
			success: true,
			wallet: {
				availableBalance: balance.availableBalance,
				pendingBalance: balance.pendingBalance,
				holdBalance: balance.holdBalance,
				totalBalance: balance.totalBalance,
				todayEarnings: todayEarnings,
				currency: "NGN",
			},
			transactions: transactions.map((tx) => ({
				...(tx.toObject ? tx.toObject() : tx),
				amount: tx.amount,
			})),
		});
	} catch (err) {
		logger.error(`Get Rider Wallet Error: ${err.message}`);
		res.status(500).json({
			success: false,
			message: "Error fetching wallet info",
			error: err.message,
		});
	}
};

/**
 * Get Rider Transaction History (paginated)
 * GET /api/riders/wallet/transactions?limit=20&offset=0
 */
const getRiderWalletTransactions = async (req, res) => {
	try {
		const riderProfile = await RiderProfile.findOne({
			user: req.user.id,
		}).select("_id");
		if (!riderProfile) {
			return res
				.status(404)
				.json({ success: false, message: "Rider profile not found" });
		}
		const riderId = riderProfile._id;

		const limit = Math.min(parseInt(req.query.limit) || 20, 100);
		const offset = parseInt(req.query.offset) || 0;

		const result = await ledgerService.getTransactionHistory(
			riderId,
			"RIDER",
			limit,
			offset,
		);

		res.status(200).json({
			success: true,
			transactions: result.transactions.map((tx) => ({
				...(tx.toObject ? tx.toObject() : tx),
				amount: tx.amount,
			})),
			total: result.total,
			hasMore: result.hasMore,
			limit,
			offset,
		});
	} catch (err) {
		logger.error(`Get Rider Wallet Transactions Error: ${err.message}`);
		res.status(500).json({
			success: false,
			message: "Error fetching transaction history",
			error: err.message,
		});
	}
};

/**
 * Update Rider Operating Area
 * PUT /api/riders/profile/operating-area
 * Body: { operatingArea: ["Zone1", "Zone2"] }
 */
const updateOperatingArea = async (req, res) => {
	try {
		const riderId = req.user.id;
		const result = await riderService.updateOperatingArea(riderId, req.body);

		res.status(200).json(result);
	} catch (err) {
		logger.error(`Update Operating Area Error: ${err.message}`);
		res.status(400).json({
			success: false,
			message: err.message,
		});
	}
};

/**
 * Get Rider Operating Area
 * GET /api/riders/operating-area
 */
const getOperatingArea = async (req, res) => {
	try {
		const riderId = req.user.id;
		const result = await riderService.getOperatingArea(riderId);

		res.status(200).json(result);
	} catch (err) {
		logger.error(`Get Operating Area Error: ${err.message}`);
		const status = err.message === "Rider not found" ? 404 : 500;
		res.status(status).json({
			success: false,
			message: "Error fetching operating area",
			error: err.message,
		});
	}
};

/**
 * Register Rider
 */
const registerRider = async (req, res) => {
	try {
		const result = await riderService.registerRider(req.body);
		logger.info(`Rider registered: ${result.message}`);
		res.status(201).json(result);
	} catch (error) {
		logger.error(`Register Rider Error: ${error.message}`);
		res.status(400).json({
			success: false,
			message: error.message,
		});
	}
};

/**
 * Update Bank Details
 */
const updateBankDetails = async (req, res) => {
	try {
		const riderId = req.user.id;
		const result = await riderService.updateBankDetails(riderId, req.body);
		res.json(result);
	} catch (err) {
		logger.error(`Update bank details failed: ${err.message}`);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Get Rider Leaderboard
 */
const riderLeaderBoard = async (req, res) => {
	try {
		const result = await riderService.getRiderLeaderboard();
		res.status(200).json(result);
	} catch (err) {
		logger.error(`Rider Leaderboard Error: ${err.message}`);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

/**
 * Complete Rider Registration
 * Handles document uploads
 */
const completeRiderRegistration = async (req, res) => {
	try {
		const riderId = req.user.id;
		// Pass req.files as well
		const result = await riderService.completeRiderRegistration(
			riderId,
			req.body,
			req.files,
		);
		return res.status(200).json({
			success: true,
			message: "Rider registration completed successfully",
			data: result,
		});
	} catch (err) {
		logger.error(`Complete Rider Registration Error: ${err.message}`);
		return res.status(500).json({
			success: false,
			message: "An error occurred while completing registration",
			error: err.message,
		});
	}
};

/**
 * Get Rider Profile
 */
const getRiderProfile = async (req, res) => {
	try {
		const riderId = req.user.id;
		const data = await riderService.getRiderProfile(riderId);
		res.json({
			success: true,
			data,
		});
	} catch (err) {
		logger.error(`Get Rider Profile Error: ${err.message}`);
		// Handle 404 specifically if needed, or generic 500
		const status = err.message === "Rider not found" ? 404 : 500;
		res.status(status).json({
			success: false,
			message: "An error occurred while fetching rider profile",
			error: err.message,
		});
	}
};
/**
 * Deactivate Rider Account
 * Sets accountStatus to 'deactivated' and prevents future logins.
 */
const deactivateRiderAccount = async (req, res) => {
	try {
		const riderId = req.user.id;
		const rider = await riderService.deactivateRiderAccount(riderId);
		res.json({
			success: true,
			message: "Rider account deactivated successfully",
			data: rider,
		});
	} catch (err) {
		logger.error(`Deactivate Rider Account Error: ${err.message}`);
		res.status(500).json({
			success: false,
			message: "An error occurred while deactivating the rider account",
			error: err.message,
		});
	}
};

/**
 * Change Rider Zone (weekly restriction)
 * PUT /api/riders/profile/zone
 * Body: { zones: ["Ogba"] }
 */
const changeZone = async (req, res) => {
	try {
		const riderId = req.user.id;
		const { zones } = req.body;
		const result = await riderService.changeZone(riderId, zones);
		res.status(200).json(result);
	} catch (err) {
		logger.error(`Change Zone Error: ${err.message}`);
		res.status(400).json({ success: false, message: err.message });
	}
};

/**
 * Update Notification Preferences
 * PUT /api/riders/notification-preferences
 * Body: { newRequests?: boolean, earnings?: boolean, promotions?: boolean }
 */
const updateNotificationPreferences = async (req, res) => {
	try {
		const riderId = req.user.id;
		const { newRequests, earnings, promotions } = req.body;

		const update = {};
		if (typeof newRequests === "boolean")
			update["notificationPreferences.newRequests"] = newRequests;
		if (typeof earnings === "boolean")
			update["notificationPreferences.earnings"] = earnings;
		if (typeof promotions === "boolean")
			update["notificationPreferences.promotions"] = promotions;

		const profile = await RiderProfile.findOneAndUpdate(
			{ user: riderId },
			{ $set: update },
			{ new: true, select: "notificationPreferences" },
		);

		res.status(200).json({
			success: true,
			notificationPreferences: profile?.notificationPreferences,
		});
	} catch (err) {
		logger.error(`Update Notification Preferences Error: ${err.message}`);
		res
			.status(500)
			.json({ success: false, message: "Failed to update preferences" });
	}
};

/**
 * Upload Profile Picture
 * POST /api/riders/profile/picture  (multipart/form-data, field: profilePicture)
 */
const uploadProfilePicture = async (req, res) => {
	try {
		const riderId = req.user.id;
		if (!req.file) {
			return res
				.status(400)
				.json({ success: false, message: "No image file provided" });
		}
		const imageUrl = req.file.path; // Cloudinary URL set by multer-storage-cloudinary
		const User = require("../models/User");
		await Promise.all([
			RiderProfile.findOneAndUpdate(
				{ user: riderId },
				{ profilePicture: imageUrl },
			),
			User.findByIdAndUpdate(riderId, { img: imageUrl }),
		]);
		res.status(200).json({ success: true, profilePicture: imageUrl });
	} catch (err) {
		logger.error(`Upload Profile Picture Error: ${err.message}`);
		res
			.status(500)
			.json({ success: false, message: "Failed to upload profile picture" });
	}
};

/**
 * Save Expo Push Token
 * POST /api/riders/push-token
 * Body: { fcmToken: string }
 */
const updatePushToken = async (req, res) => {
	try {
		const userId = req.user.id;
		const { fcmToken } = req.body;

		if (!fcmToken) {
			return res
				.status(400)
				.json({ success: false, message: "fcmToken is required" });
		}

		await RiderProfile.findOneAndUpdate({ user: userId }, { fcmToken });
		res.status(200).json({ success: true, message: "Push token saved" });
	} catch (err) {
		logger.error(`Update Push Token Error: ${err.message}`);
		res
			.status(500)
			.json({ success: false, message: "Failed to save push token" });
	}
};

/**
 * Update rider online/offline status
 * PUT /api/riders/status
 * Body: { status: "available" | "offline" }
 */
const updateRiderOnlineStatus = async (req, res) => {
	try {
		const { status } = req.body;
		if (!["available", "offline"].includes(status)) {
			return res.status(400).json({
				success: false,
				message: "Status must be 'available' or 'offline'",
			});
		}
		const result = await riderService.updateRiderStatus(req.user.id, status);
		res.json(result);
	} catch (err) {
		logger.error(`Update rider status error: ${err.message}`);
		res.status(500).json({ success: false, message: err.message });
	}
};

module.exports = {
	completeRiderRegistration,
	registerRider,
	updateBankDetails,
	riderLeaderBoard,
	getRiderProfile,
	getRiderWallet,
	getRiderWalletTransactions,
	updateOperatingArea,
	getOperatingArea,
	changeZone,
	deactivateRiderAccount,
	updatePushToken,
	uploadProfilePicture,
	updateNotificationPreferences,
	updateRiderOnlineStatus,
};
