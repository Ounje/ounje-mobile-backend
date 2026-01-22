const express = require("express");
const { NINStorage } = require("../config/cloudinary");
const {
	getPopularVendors,
	getVendor,
	userGetVendor,
	updateBankDetails,
	getNearbyVendors,
	completeVendorRegistration,
} = require("../controllers/vendorController");
const { authMiddleware, roleGuard } = require("../middleware/auth");

const router = express.Router();

router.get("/popular", getPopularVendors);

router.get("/profile", authMiddleware, getVendor);

// Vendor updates their bank details and trigger retries of pending payouts
router.put(
	"/profile/bank-details",
	authMiddleware,
	roleGuard(["vendor"]),
	updateBankDetails,
);

router.get("/vendor/:id", userGetVendor);

router.get("/nearby", authMiddleware, getNearbyVendors);
router.post(
	"/complete-registration",
	authMiddleware,
	roleGuard(["vendor"]),
	NINStorage.single("ninID"),
	completeVendorRegistration,
);

module.exports = router;
