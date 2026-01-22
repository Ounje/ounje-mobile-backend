// routes/ratingRoutes.js
const express = require("express");
const router = express.Router();
const { authMiddleware, roleGuard } = require("../middleware/auth");
const {
	rateFood,
	rateCombo,
	rateVendor,
	rateRider,
	getReviews,
	deleteReview,
} = require("../controllers/ratingController");

// Rate entities (customer only)
router.post("/food/:id", authMiddleware, roleGuard(["customer"]), rateFood);
router.post("/combo/:id", authMiddleware, roleGuard(["customer"]), rateCombo);
router.post("/vendor/:id", authMiddleware, roleGuard(["customer"]), rateVendor);
router.post("/rider/:id", authMiddleware, roleGuard(["customer"]), rateRider);

// Get reviews (public)
router.get("/:targetType/:targetId", getReviews);

// Delete own review (customer only)
router.delete(
	"/:reviewId",
	authMiddleware,
	roleGuard(["customer"]),
	deleteReview,
);

module.exports = router;
