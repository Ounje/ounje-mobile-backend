const riderService = require("../services/rider.service");
const logger = require("../utils/logger");

/**
 * Get Rider Wallet/Dashboard
 */
const getRiderWallet = async (req, res) => {
	try {
		const riderId = req.user.id;
		const walletData = await riderService.getRiderDashboard(riderId);
		res.status(200).json({
			success: true,
			...walletData,
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

module.exports = {
	completeRiderRegistration,
	registerRider,
	updateBankDetails,
	riderLeaderBoard,
	getRiderProfile,
	getRiderWallet,
	updateOperatingArea,
	getOperatingArea,
	deactivateRiderAccount,
};
