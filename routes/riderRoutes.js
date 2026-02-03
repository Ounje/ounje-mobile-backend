// routes/riderRoutes.js (Corrected)

const express = require("express");
const router = express.Router(); // FIX 1: Must initialize the router
const db = require("../config/db"); // FIX 2: Assuming 'db' helper is accessible/imported here
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { riderUpload } = require("../config/cloudinary");
const {
	updateBankDetails,
	riderLeaderBoard,
	completeRiderRegistration,
	getRiderProfile,
	getRiderWallet,
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
router.post("/location", async (req, res) => {
	const { riderId, longitude, latitude } = req.body;

	try {
		// 1. Update the rider's current position in your DB (Ensure this function exists)
		await db.riders.updateLocation(riderId, longitude, latitude);

		// 2. Get the active order assigned to this rider (Ensure this function exists)
		// FIX 5: Use riderId to find the order
		const activeOrder = await db.orders.findByRider(riderId);

		if (activeOrder) {
			// 3. Trigger the Directions API calculation
			await updateLiveTracking(activeOrder.id, [longitude, latitude]);
		}

		res
			.status(200)
			.send({ status: "Location updated and tracking processed." });
	} catch (error) {
		console.error("Rider location update failed:", error.message);
		res
			.status(500)
			.send({ message: "Failed to update location.", error: error.message });
	}
});

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

router.get("/profile", authMiddleware, roleGuard(["rider"]), getRiderProfile);

// Rider Wallet & Earnings
router.get("/wallet", authMiddleware, roleGuard(["rider"]), getRiderWallet);

module.exports = router;
