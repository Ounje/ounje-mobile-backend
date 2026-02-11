const express = require("express");
const { NINStorage, vendorImageUpload } = require("../config/cloudinary");
const {
	getPopularVendors,
	getVendor,
	userGetVendor,
	updateBankDetails,
	getNearbyVendors,
	completeVendorRegistration,
	updateVendorProfileImage,
	deleteVendorProfileImage,
	deactivateVendorAccount,
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

/**
 * @swagger
 * /api/vendors/popular:
 *   get:
 *     summary: Get popular vendors
 *     tags: [Vendors]
 *     responses:
 *       200:
 *         description: List of popular vendors
 */
router.get("/popular", getPopularVendors);

/**
 * @swagger
 * /api/vendors/profile:
 *   get:
 *     summary: Get logged-in vendor profile
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vendor profile
 *       404:
 *         description: Vendor not found
 */
router.get("/profile", authMiddleware, checkActiveUser, getVendor);

// Vendor updates their bank details and trigger retries of pending payouts
/**
 * @swagger
 * /api/vendors/profile/bank-details:
 *   put:
 *     summary: Update vendor bank details
 *     tags: [Vendors]
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
	checkActiveUser,
	roleGuard(["vendor"]),
	updateBankDetails,
);

/**
 * @swagger
 * /api/vendors/vendor/{id}:
 *   get:
 *     summary: Get vendor public profile
 *     tags: [Vendors]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vendor details
 *       404:
 *         description: Vendor not found
 */
router.get("/vendor/:id", userGetVendor);

/**
 * @swagger
 * /api/vendors/nearby:
 *   get:
 *     summary: Get nearby vendors
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
 *         description: List of nearby vendors
 */
router.get("/nearby", authMiddleware, getNearbyVendors);
/**
 * @swagger
 * /api/vendors/complete-registration:
 *   post:
 *     summary: Complete vendor registration
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - storeName
 *               - storeType
 *               - servicesOffered
 *               - ninID
 *             properties:
 *               storeName:
 *                 type: string
 *               storeType:
 *                 type: string
 *                 enum: [physicalStore, onlineStore]
 *               servicesOffered:
 *                 type: string
 *                 enum: [InstantMeals, preOrderMeals, hybridMeals]
 *               isVerifiedBusiness:
 *                 type: boolean
 *               CACNumber:
 *                 type: string
 *               needCACHelp:
 *                 type: string
 *                 enum: [yes, no]
 *               ninID:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Registration completed
 *       400:
 *         description: Missing fields or validation error
 */
router.post(
	"/complete-registration",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	NINStorage.single("ninID"),
	completeVendorRegistration,
);

router.put(
	"/profile/upload/image",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	vendorImageUpload.single("profileImage"),
	updateVendorProfileImage,
);

router.delete(
	"/profile/delete/image",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	deleteVendorProfileImage,
);

router.delete(
	"/profile/deactivate",
	authMiddleware,
	roleGuard(["vendor"]),
	deactivateVendorAccount,
);

module.exports = router;
