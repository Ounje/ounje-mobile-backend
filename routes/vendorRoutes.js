const express = require("express");
const { NINStorage, vendorImageUpload } = require("../config/cloudinary");
const {
	getPopularVendors,
	getAllVendors,
	getVendor,
	userGetVendor,
	updateBankDetails,
	getNearbyVendors,
	completeVendorRegistration,
	updateVendorProfileImage,
	deleteVendorProfileImage,
	deactivateVendorAccount,
	updateVendorLocation,
	updateVendorProfile,
	toggleVendorOnlineStatus,
	getVendorWallet,
	updateOperatingPeriods,
	addOperatingPeriod,
	deleteOperatingPeriod,
} = require("../controllers/vendorController");
const {
	authMiddleware,
	roleGuard,
	checkActiveUser,
} = require("../middleware/auth");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Vendors
 *   description: Vendor Management and Discovery
 */

// ── Public ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vendors/popular:
 *   get:
 *     summary: Get popular vendors
 *     tags: [Vendors]
 *     parameters:
 *       - in: query
 *         name: zone
 *         schema:
 *           type: string
 *         description: Filter by Lagos zone name (e.g. "Lekki", "Surulere")
 *     responses:
 *       200:
 *         description: List of popular vendors sorted by rating
 */
router.get("/popular", getPopularVendors);

/**
 * @swagger
 * /api/vendors/all:
 *   get:
 *     summary: Get all active vendors
 *     tags: [Vendors]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *         description: Customer latitude — when provided with lng, returns distanceMeters
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *         description: Customer longitude
 *     responses:
 *       200:
 *         description: List of all active vendors (max 200)
 */
router.get("/all", getAllVendors);

/**
 * @swagger
 * /api/vendors/vendor/{id}:
 *   get:
 *     summary: Get vendor public profile with menu
 *     description: Returns vendor details, food items, combos, and estimated delivery time if customer location is available.
 *     tags: [Vendors]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: VendorProfile document ID
 *     responses:
 *       200:
 *         description: Vendor details with food items and combos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 isOnline:
 *                   type: boolean
 *                 foodItems:
 *                   type: array
 *                 combos:
 *                   type: array
 *                 estimatedDeliveryTime:
 *                   type: number
 *                   description: Minutes (includes 10 min prep buffer)
 *       400:
 *         description: Invalid vendor ID format
 *       404:
 *         description: Vendor not found
 */
router.get("/vendor/:id", userGetVendor);

/**
 * @swagger
 * /api/vendors/nearby:
 *   get:
 *     summary: Get nearby vendors
 *     description: >
 *       Returns vendors within 10 km first, then further vendors.
 *       Falls back to the customer's saved address if lat/lng are not provided.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Vendors sorted by distance
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 source:
 *                   type: string
 *                   enum: [location-based, default-fallback]
 *                 results:
 *                   type: integer
 *                 nearby:
 *                   type: integer
 *                 further:
 *                   type: integer
 *                 data:
 *                   type: array
 */
router.get("/nearby", authMiddleware, getNearbyVendors);

// ── Vendor profile (authenticated) ───────────────────────────────────────────

/**
 * @swagger
 * /api/vendors/profile:
 *   get:
 *     summary: Get logged-in vendor's own profile
 *     description: Returns full vendor profile including bank details, order stats (totalOrders, ordersToday), and store configuration.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vendor profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 storeDetails:
 *                   type: array
 *                 bankDetails:
 *                   type: object
 *                 totalOrders:
 *                   type: integer
 *                 ordersToday:
 *                   type: integer
 *       404:
 *         description: Vendor not found
 *   put:
 *     summary: Update vendor store name
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeName]
 *             properties:
 *               storeName:
 *                 type: string
 *                 example: "Mama's Kitchen"
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: storeName is required
 *       404:
 *         description: Vendor not found
 */
router.get("/profile", authMiddleware, checkActiveUser, getVendor);
router.put(
	"/profile",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	updateVendorProfile,
);

/**
 * @swagger
 * /api/vendors/profile/location:
 *   put:
 *     summary: Update vendor location
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, coordinates]
 *             properties:
 *               address:
 *                 type: string
 *                 example: "8 Bode Thomas Street, Surulere, Lagos, Nigeria"
 *               coordinates:
 *                 type: array
 *                 items:
 *                   type: number
 *                 description: "[longitude, latitude] — GeoJSON order"
 *                 example: [3.3656851, 6.5351659]
 *     responses:
 *       200:
 *         description: Location updated
 *       400:
 *         description: address and coordinates [longitude, latitude] are required
 */
router.put(
	"/profile/location",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	updateVendorLocation,
);

/**
 * @swagger
 * /api/vendors/profile/bank-details:
 *   put:
 *     summary: Update vendor bank details
 *     description: Saves bank details and automatically retries any pending payouts for this vendor.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountNumber, bankCode, accountName]
 *             properties:
 *               accountNumber:
 *                 type: string
 *                 example: "0123456789"
 *               bankCode:
 *                 type: string
 *                 example: "044"
 *               accountName:
 *                 type: string
 *                 example: "John Doe"
 *     responses:
 *       200:
 *         description: Bank details updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 vendor:
 *                   type: object
 *                 retryResults:
 *                   type: object
 *       400:
 *         description: Missing required fields
 */
router.put(
	"/profile/bank-details",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	updateBankDetails,
);

/**
 * @swagger
 * /api/vendors/profile/periods:
 *   get:
 *     summary: (See GET /api/vendors/profile)
 *     description: Current periods are returned as part of storeDetails in the vendor profile endpoint.
 *     tags: [Vendors]
 *   put:
 *     summary: Replace entire operating schedule
 *     description: >
 *       Replaces all timePeriod or preorderPeriods entries depending on the vendor's
 *       servicesOffered. The server auto-detects which field to update based on the
 *       vendor's registered service type. Send an empty array `[]` to clear the schedule.
 *
 *
 *       **For InstantMeals / hybridMeals** — send timePeriod entries:
 *       ```json
 *       {
 *         "periods": [
 *           { "day": "monday", "openingHour": "9:00 AM", "closingHour": "10:00 PM" },
 *           { "day": "tuesday", "openingHour": "9:00 AM", "closingHour": "10:00 PM" }
 *         ]
 *       }
 *       ```
 *
 *
 *       **For preOrderMeals** — send preorderPeriod entries:
 *       ```json
 *       {
 *         "periods": [
 *           { "orderingTime": "8:00 AM", "preparationTime": "30 mins", "period": "breakfast" }
 *         ]
 *       }
 *       ```
 *
 *
 *       Accepted time formats: `"HH:MM"` (24-hour) or `"H:MM AM/PM"` (12-hour).
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [periods]
 *             properties:
 *               periods:
 *                 type: array
 *                 description: Array of period objects. Type inferred from vendor's servicesOffered.
 *                 items:
 *                   oneOf:
 *                     - type: object
 *                       description: timePeriod entry (InstantMeals / hybridMeals)
 *                       required: [day, openingHour, closingHour]
 *                       properties:
 *                         day:
 *                           type: string
 *                           enum: [sunday, monday, tuesday, wednesday, thursday, friday, saturday]
 *                         openingHour:
 *                           type: string
 *                           example: "9:00 AM"
 *                         closingHour:
 *                           type: string
 *                           example: "10:00 PM"
 *                     - type: object
 *                       description: preorderPeriod entry (preOrderMeals)
 *                       required: [orderingTime, preparationTime, period]
 *                       properties:
 *                         orderingTime:
 *                           type: string
 *                           example: "8:00 AM"
 *                         preparationTime:
 *                           type: string
 *                           example: "30 mins"
 *                         period:
 *                           type: string
 *                           enum: [breakfast, lunch, dinner]
 *     responses:
 *       200:
 *         description: Schedule replaced successfully
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
 *                     message:
 *                       type: string
 *                     servicesOffered:
 *                       type: string
 *                     timePeriod:
 *                       type: array
 *                     preorderPeriods:
 *                       type: array
 *       400:
 *         description: Validation error or wrong period format for vendor type
 *       404:
 *         description: Vendor not found
 *   post:
 *     summary: Add a single period entry
 *     description: >
 *       Appends one period entry to the existing schedule without replacing the rest.
 *       Duplicate entries are rejected — a duplicate is the same `day` for
 *       InstantMeals/hybridMeals, or the same `period` (breakfast/lunch/dinner)
 *       for preOrderMeals. Delete the existing entry first before re-adding.
 *
 *
 *       **For InstantMeals / hybridMeals:**
 *       ```json
 *       { "day": "monday", "openingHour": "9:00 AM", "closingHour": "10:00 PM" }
 *       ```
 *
 *
 *       **For preOrderMeals:**
 *       ```json
 *       { "orderingTime": "8:00 AM", "preparationTime": "30 mins", "period": "breakfast" }
 *       ```
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 description: timePeriod entry (InstantMeals / hybridMeals)
 *                 required: [day, openingHour, closingHour]
 *                 properties:
 *                   day:
 *                     type: string
 *                     enum: [sunday, monday, tuesday, wednesday, thursday, friday, saturday]
 *                   openingHour:
 *                     type: string
 *                     example: "9:00 AM"
 *                   closingHour:
 *                     type: string
 *                     example: "10:00 PM"
 *               - type: object
 *                 description: preorderPeriod entry (preOrderMeals)
 *                 required: [orderingTime, preparationTime, period]
 *                 properties:
 *                   orderingTime:
 *                     type: string
 *                     example: "8:00 AM"
 *                   preparationTime:
 *                     type: string
 *                     example: "30 mins"
 *                   period:
 *                     type: string
 *                     enum: [breakfast, lunch, dinner]
 *     responses:
 *       201:
 *         description: Period added successfully
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
 *                     message:
 *                       type: string
 *                     servicesOffered:
 *                       type: string
 *                     timePeriod:
 *                       type: array
 *                     preorderPeriods:
 *                       type: array
 *       400:
 *         description: Validation error or duplicate entry
 *       404:
 *         description: Vendor not found
 */
router.put(
	"/profile/periods",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	updateOperatingPeriods,
);

router.post(
	"/profile/periods",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	addOperatingPeriod,
);

/**
 * @swagger
 * /api/vendors/profile/periods/{index}:
 *   delete:
 *     summary: Remove a period entry by index
 *     description: >
 *       Removes the period at the given zero-based index from the schedule.
 *       Use `GET /api/vendors/profile` to see the current periods array and identify
 *       the index to remove.
 *
 *
 *       Example — if preorderPeriods is:
 *       ```json
 *       [
 *         { "period": "breakfast", "orderingTime": "8:00 AM" },
 *         { "period": "lunch",     "orderingTime": "12:00 PM" }
 *       ]
 *       ```
 *       `DELETE /api/vendors/profile/periods/0` removes breakfast.
 *       `DELETE /api/vendors/profile/periods/1` removes lunch.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: index
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 0
 *         description: Zero-based index of the period entry to remove
 *     responses:
 *       200:
 *         description: Period removed successfully
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
 *                     message:
 *                       type: string
 *                     servicesOffered:
 *                       type: string
 *                     timePeriod:
 *                       type: array
 *                     preorderPeriods:
 *                       type: array
 *       400:
 *         description: Invalid index or index out of range
 *       404:
 *         description: Vendor not found
 */
router.delete(
	"/profile/periods/:index",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	deleteOperatingPeriod,
);

/**
 * @swagger
 * /api/vendors/complete-registration:
 *   post:
 *     summary: Complete vendor store registration
 *     description: >
 *       One-time step after account creation. Uploads NIN ID document and sets up
 *       store configuration. Cannot be called again once completed.
 *
 *
 *       For **preOrderMeals**, include `preorderPeriods` as a JSON string array:
 *       ```
 *       preorderPeriods=[{"orderingTime":"8:00 AM","preparationTime":"30 mins","period":"breakfast"}]
 *       ```
 *
 *
 *       For **InstantMeals / hybridMeals**, include `timePeriod` as a JSON string array:
 *       ```
 *       timePeriod=[{"day":"monday","openingHour":"9:00 AM","closingHour":"10:00 PM"}]
 *       ```
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [storeName, storeType, servicesOffered, ninID]
 *             properties:
 *               storeName:
 *                 type: string
 *                 example: "Mama's Kitchen"
 *               storeType:
 *                 type: string
 *                 enum: [physicalStore, onlineStore]
 *               servicesOffered:
 *                 type: string
 *                 enum: [InstantMeals, preOrderMeals, hybridMeals]
 *               isVerifiedBusiness:
 *                 type: boolean
 *                 description: Set true if CAC-registered. False requires needCACHelp.
 *               CACNumber:
 *                 type: string
 *                 description: Required when isVerifiedBusiness is true
 *               needCACHelp:
 *                 type: string
 *                 enum: [yes, no]
 *                 description: Required when isVerifiedBusiness is false
 *               timePeriod:
 *                 type: string
 *                 description: JSON string array of timePeriod entries (InstantMeals/hybridMeals)
 *               preorderPeriods:
 *                 type: string
 *                 description: JSON string array of preorderPeriod entries (preOrderMeals)
 *               ninID:
 *                 type: string
 *                 format: binary
 *                 description: NIN ID document image (required)
 *     responses:
 *       200:
 *         description: Registration completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 vendor:
 *                   type: object
 *                 accountStatus:
 *                   type: string
 *                   enum: [active, pending]
 *                 warning:
 *                   type: string
 *                   description: Present when accountStatus is pending
 *       400:
 *         description: Missing fields, invalid values, or registration already completed
 *       404:
 *         description: Vendor not found
 */
router.post(
	"/complete-registration",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	NINStorage.single("ninID"),
	completeVendorRegistration,
);

/**
 * @swagger
 * /api/vendors/profile/upload/image:
 *   put:
 *     summary: Upload or replace vendor profile image
 *     description: Uploads image to Cloudinary and replaces any existing profile image.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [profileImage]
 *             properties:
 *               profileImage:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile image updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 imageUrl:
 *                   type: string
 *                 img:
 *                   type: string
 *       400:
 *         description: No image file provided
 */
router.put(
	"/profile/upload/image",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	vendorImageUpload.single("profileImage"),
	updateVendorProfileImage,
);

/**
 * @swagger
 * /api/vendors/profile/delete/image:
 *   delete:
 *     summary: Delete vendor profile image
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile image deleted
 *       400:
 *         description: No profile image to delete
 */
router.delete(
	"/profile/delete/image",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	deleteVendorProfileImage,
);

/**
 * @swagger
 * /api/vendors/profile/deactivate:
 *   delete:
 *     summary: Deactivate vendor account
 *     description: Sets store status to "deactivated" and marks the account as inactive. Contact support to reactivate.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vendor account deactivated
 *       404:
 *         description: Vendor not found
 */
router.delete(
	"/profile/deactivate",
	authMiddleware,
	roleGuard(["vendor"]),
	deactivateVendorAccount,
);

/**
 * @swagger
 * /api/vendors/profile/status:
 *   patch:
 *     summary: Toggle vendor online/offline status
 *     description: >
 *       Toggles the store between "active" (online) and "deactivated" (offline).
 *       Going offline is blocked if the vendor has an active order in `confirming`
 *       or `pending` status. Note: this does NOT affect `isActive` (account-level activation).
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status toggled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 isOnline:
 *                   type: boolean
 *                 isActive:
 *                   type: boolean
 *                   description: Account-level activation — unchanged by this endpoint
 *                 message:
 *                   type: string
 *       400:
 *         description: Blocked — active order in progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 blocked:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: Vendor not found
 */
router.patch(
	"/profile/status",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	toggleVendorOnlineStatus,
);

/**
 * @swagger
 * /api/vendors/wallet:
 *   get:
 *     summary: Get vendor wallet balance and earnings
 *     description: >
 *       Returns the vendor's ledger balances broken into three buckets:
 *       - **availableBalance** — withdrawable funds
 *       - **pendingBalance** — earnings from accepted orders, not yet released
 *       - **holdBalance** — earnings from unconfirmed orders
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet info and recent transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 wallet:
 *                   type: object
 *                   properties:
 *                     availableBalance:
 *                       type: number
 *                     pendingBalance:
 *                       type: number
 *                     holdBalance:
 *                       type: number
 *                     totalBalance:
 *                       type: number
 *                     todayEarnings:
 *                       type: number
 *                     currency:
 *                       type: string
 *                       example: NGN
 *                 transactions:
 *                   type: array
 *                   description: Last 20 ledger transactions
 *                   items:
 *                     type: object
 *       404:
 *         description: Vendor profile not found
 */
router.get(
	"/wallet",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	getVendorWallet,
);

module.exports = router;