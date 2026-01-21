const express = require("express");
const router = express.Router();
const {
	rateFood,
	rateCombo,
	rateVendor,
	rateRider,
	getReviews,
} = require("../controllers/ratingAndReviewsController");
const { authMiddleware, roleGuard } = require("../middleware/auth");

router.post("/food/:id", authMiddleware, roleGuard(["customer"]), rateFood);

router.post("/combo/:id", authMiddleware, roleGuard(["customer"]), rateCombo);

router.post("/vendor/:id", authMiddleware, roleGuard(["customer"]), rateVendor);

router.post("/rider/:id", authMiddleware, roleGuard(["customer"]), rateRider);

router.get(
	"/reviews/:targetType/:targetId",
	authMiddleware,
	roleGuard(["customer"]),
	getReviews,
);

module.exports = router;
