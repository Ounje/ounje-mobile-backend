// routes/riderRoutes.js (Corrected)

const express = require("express");
const router = express.Router(); // FIX 1: Must initialize the router
const db = require("../config/db"); // FIX 2: Assuming 'db' helper is accessible/imported here
const {
	authMiddleware,
	roleGuard,
	checkActiveUser,
} = require("../middleware/auth");
const { riderUpload } = require("../config/cloudinary");
const { AVAILABLE_ZONES } = require("../utils/constants");
const {
	updateBankDetails,
	riderLeaderBoard,
	completeRiderRegistration,
	getRiderProfile,
	getRiderWallet,
	getRiderWalletTransactions,
	getOperatingArea,
	updateOperatingArea,
	deactivateRiderAccount,
	updatePushToken,
	uploadProfilePicture,
	updateNotificationPreferences,
} = require("../controllers/riderController");

// FIX 3: Endpoint corrected to '/location' since the server.js prefix is '/api/riders'
// FIX 4: Changed internal logic references from 'driverId' to 'riderId'
/**
 * @swagger
 * tags:
 *   name: Riders
 *   description: Rider Management and Tracking
 */

/**
 * @swagger
 * /api/riders/location:
 *   post:
 *     summary: Update rider location
 *     tags: [Riders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - riderId
 *               - longitude
 *               - latitude
 *             properties:
 *               riderId:
 *                 type: string
 *               longitude:
 *                 type: number
 *               latitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Location updated
 *       500:
 *         description: Server error
 */
router.post("/location", authMiddleware, roleGuard(["rider"]), async (req, res) => {
	const { longitude, latitude } = req.body;
	const riderId = req.user?.id || req.user?._id;

	if (!longitude || !latitude) {
		return res.status(400).json({ message: "longitude and latitude are required" });
	}

	try {
		// Update rider location directly via Mongoose
		await db.riders.findByIdAndUpdate(riderId, {
			$set: {
				"currentLocation.type": "Point",
				"currentLocation.coordinates": [parseFloat(longitude), parseFloat(latitude)],
			}
		});

		res.status(200).json({ status: "Location updated." });
	} catch (error) {
		console.error("Rider location update failed:", error.message);
		res.status(500).json({ message: "Failed to update location.", error: error.message });
	}
});

// Upload rider profile picture to Cloudinary
router.post(
	"/profile/picture",
	authMiddleware,
	roleGuard(["rider"]),
	riderUpload.single("profilePicture"),
	uploadProfilePicture,
);

// Rider updates their bank details and triggers pending payouts retry
/**
 * @swagger
 * /api/riders/profile/bank-details:
 *   put:
 *     summary: Update rider bank details
 *     tags: [Riders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accountNumber
 *               - bankCode
 *               - accountName
 *             properties:
 *               accountNumber:
 *                 type: string
 *               bankCode:
 *                 type: string
 *               accountName:
 *                 type: string
 *               bankName:
 *                 type: string
 *                 description: Optional bank name
 *     responses:
 *       200:
 *         description: Bank details updated
 *       400:
 *         description: Missing fields
 */
router.put(
	"/profile/bank-details",
	authMiddleware,
	roleGuard(["rider"]),
	updateBankDetails,
);

router.post(
	"/complete-registration",
	authMiddleware,
	roleGuard(["rider"]),
	riderUpload.fields([
		{ name: "driversLicense", maxCount: 1 },
		{ name: "nin", maxCount: 1 },
		{ name: "guarantorNin", maxCount: 1 },
	]),
	completeRiderRegistration,
);
/**
 * @swagger
 * /api/riders/leaderboard:
 *   get:
 *     summary: Get rider leaderboard
 *     tags: [Riders]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Leaderboard data
 */
router.get("/leaderboard", riderLeaderBoard);

// Get available delivery zones (public)
router.get("/zones", (req, res) => {
	res.status(200).json({ success: true, zones: AVAILABLE_ZONES });
});
/**
 * @route   GET /api/riders/operating-area
 * @desc    Get rider's current operating area/zones
 * @access  Private (Rider only)
 */
router.get("/operating-area", authMiddleware, getOperatingArea);

/**
 * @route   PUT /api/riders/profile/operating-area
 * @desc    Update rider's operating area (max 2 zones)
 * @access  Private (Rider only)
 * @body    { operatingArea: ["Zone1", "Zone2"] }
 */
router.put(
	"/profile/operating-area",
	authMiddleware,
	roleGuard(["rider"]),
	updateOperatingArea,
);

router.delete(
	"/profile/deactivate",
	authMiddleware,
	roleGuard(["rider"]),
	deactivateRiderAccount,
);

// Get authenticated rider's own reviews
router.get(
	"/reviews",
	authMiddleware,
	roleGuard(["rider"]),
	async (req, res) => {
		const { getReviews } = require("../controllers/ratingController");
		req.params = { targetType: "Rider", targetId: req.user.id };
		return getReviews(req, res);
	},
);

/**
 * @swagger
 * /api/riders/profile:
 *   get:
 *     summary: Get rider profile including wallet and stats
 *     tags: [Riders]
 *     responses:
 *       200:
 *         description: Rider profile data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     wallet:
 *                       type: object
 *                       properties:
 *                         availableBalance:
 *                           type: number
 *                         pendingBalance:
 *                           type: number
 *                         totalBalance:
 *                           type: number
 *                         currency:
 *                           type: string
 *                     stats:
 *                       type: object
 *                     bankDetails:
 *                       type: object
 * */
router.get(
	"/profile",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	getRiderProfile,
);

// Rider Wallet & Earnings
/**
 * @swagger
 * /api/riders/wallet:
 *   get:
 *     summary: Get rider wallet balance and earnings
 *     tags: [Riders]
 *     responses:
 *       200:
 *         description: Wallet information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet:
 *                   type: object
 *                   properties:
 *                     availableBalance:
 *                       type: number
 *                     pendingBalance:
 *                       type: number
 *                     totalBalance:
 *                       type: number
 *                     currency:
 *                       type: string
 * */
router.get("/wallet", authMiddleware, roleGuard(["rider"]), getRiderWallet);

/**
 * @swagger
 * /api/riders/wallet/transactions:
 *   get:
 *     summary: Get paginated rider transaction history
 *     tags: [Riders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Transaction history
 */
router.get(
	"/wallet/transactions",
	authMiddleware,
	roleGuard(["rider"]),
	getRiderWalletTransactions,
);

// Save device push token for notifications
router.post(
	"/push-token",
	authMiddleware,
	roleGuard(["rider"]),
	updatePushToken,
);

// Update notification preferences
router.put(
	"/notification-preferences",
	authMiddleware,
	roleGuard(["rider"]),
	updateNotificationPreferences,
);

module.exports = router;