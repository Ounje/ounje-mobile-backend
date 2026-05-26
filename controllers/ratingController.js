const ratingService = require("../services/rating.service");
const likeService = require("../services/like.service");
const logger = require("../utils/logger");
const mongoose = require("mongoose");

// Helper: Convert User ID to Profile ID for Vendor/Rider
const getProfileId = async (targetType, userId) => {
	if (targetType === "Vendor") {
		const VendorProfile = mongoose.model("VendorProfile");
		const vendor = await VendorProfile.findOne({ owner: userId });
		if (vendor) return vendor._id.toString();

		const byId = await VendorProfile.findById(userId);
		if (byId) return byId._id.toString();

		throw new Error("Vendor profile not found for this user");
	} else if (targetType === "Rider") {
		const RiderProfile = mongoose.model("RiderProfile");
		const rider = await RiderProfile.findOne({ user: userId });
		if (rider) return rider._id.toString();

		const byId = await RiderProfile.findById(userId);
		if (byId) return byId._id.toString();

		throw new Error("Rider profile not found for this user");
	}
	return userId; // FoodItem and Combo use their own IDs directly
};

// Main handler for rating & likes
const rateEntity = async ({ req, res, targetType }) => {
	try {
		const { rating, comment, like, orderId } = req.body;
		let result = {};

		// Convert User ID to Profile ID if needed
		const profileId = await getProfileId(targetType, req.params.id);

		// 1. Handle Like
		if (like !== undefined) {
			const likeResult = await likeService.toggleLike(
				req.user.id,
				targetType,
				profileId,
				like,
			);
			result = { ...result, ...likeResult };
		}

		// 2. Handle Rating
		if (rating !== undefined || comment !== undefined) {
			const ratingResult = await ratingService.rateEntity(
				req.user.id,
				targetType,
				profileId,
				{ rating, comment, orderId },
			);
			result = { ...result, ...ratingResult };
		}

		if (like === undefined && rating === undefined && comment === undefined) {
			return res.status(400).json({
				success: false,
				message: "No rating, comment, or like provided",
			});
		}

		return res.status(200).json({
			success: true,
			message: "Your feedback was successfully recorded",
			data: result,
		});
	} catch (err) {
		logger.error(`Rate ${targetType} Error: ${err.message}`);
		const status = err.message.includes("not found")
			? 404
			: err.message.includes("Invalid") ||
				err.message.includes("Rating must be")
				? 400
				: err.message.includes("can only rate")
					? 403
					: 500;

		return res.status(status).json({
			success: false,
			message: err.message || "Error processing feedback",
		});
	}
};

// Check if the current customer has already rated an order
const checkOrderRating = async (req, res) => {
	try {
		const { orderId } = req.params;
		const result = await ratingService.checkOrderRating(req.user.id, orderId);
		return res.status(200).json({ success: true, data: result });
	} catch (err) {
		logger.error(`Check Order Rating Error: ${err.message}`);
		return res.status(500).json({ success: false, message: err.message });
	}
};

// Get reviews
const getReviews = async (req, res) => {
	try {
		const { targetType, targetId } = req.params;
		const { page, limit } = req.query;

		// Convert provided ID (likely User ID) to Profile ID
		const profileId = await getProfileId(targetType, targetId);

		const result = await ratingService.getReviews(targetType, profileId, {
			page,
			limit,
		});

		return res.status(200).json({
			success: true,
			...result,
		});
	} catch (err) {
		logger.error(`Get Reviews Error: ${err.message}`);
		return res.status(500).json({
			success: false,
			message: "Error fetching reviews",
			error: err.message,
		});
	}
};

// Delete review
const deleteReview = async (req, res) => {
	try {
		const { reviewId } = req.params;
		await ratingService.deleteReview(reviewId, req.user.id);

		return res
			.status(200)
			.json({ success: true, message: "Review deleted successfully" });
	} catch (err) {
		logger.error(`Delete Review Error: ${err.message}`);
		const status = err.message.includes("not found")
			? 404
			: err.message.includes("only delete your own")
				? 403
				: 500;

		return res.status(status).json({
			success: false,
			message: err.message || "Error deleting review",
		});
	}
};

module.exports = {
	rateFood: (req, res) => rateEntity({ req, res, targetType: "FoodItem" }),
	rateCombo: (req, res) => rateEntity({ req, res, targetType: "Combo" }),
	rateVendor: (req, res) => rateEntity({ req, res, targetType: "Vendor" }),
	rateRider: (req, res) => rateEntity({ req, res, targetType: "Rider" }),
	ratePlate: (req, res) => rateEntity({ req, res, targetType: "Plate" }),
	getReviews,
	deleteReview,
	checkOrderRating,
};
