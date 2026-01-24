const ratingService = require("../services/rating.service");
const likeService = require("../services/like.service");

// Main handler for rating & likes
const rateEntity = async ({ req, res, targetType }) => {
	try {
    const { rating, comment, like } = req.body;
    let result = {};

    // 1. Handle Like
    if (like !== undefined) {
        const likeResult = await likeService.toggleLike(
            req.user._id,
            targetType,
            req.params.id,
            like
        );
        result = { ...result, ...likeResult };
    }

    // 2. Handle Rating
    if (rating !== undefined || comment !== undefined) {
		const ratingResult = await ratingService.rateEntity(
			req.user._id,
			targetType,
			req.params.id,
			{ rating, comment }
		);
        result = { ...result, ...ratingResult };
    }

    // If both are undefined, it's a bad request, but the services or previous logic handled simple checks.
    // The previous controller didn't explicitly check if BOTH were missing at the top level, 
    // but the individual checks inside would catch it or do nothing.
    // Let's ensure we did something.
    if (like === undefined && rating === undefined && comment === undefined) {
         return res.status(400).json({ success: false, message: "No rating, comment, or like provided" });
    }

		return res.status(200).json({
			success: true,
			message: "Your feedback was successfully recorded",
			data: result,
		});
	} catch (err) {
		console.error(`Rate ${targetType} Error:`, err);
		const status = err.message.includes("not found") ? 404 : 
                   err.message.includes("Invalid") || err.message.includes("Rating must be") ? 400 : 
                   err.message.includes("can only rate") ? 403 : 500;
        
		return res.status(status).json({
			success: false,
			message: err.message || "Error processing feedback",
		});
	}
};

// Get reviews
const getReviews = async (req, res) => {
	try {
		const { targetType, targetId } = req.params;
    const { page, limit } = req.query;
    
    const result = await ratingService.getReviews(targetType, targetId, { page, limit });

		return res.status(200).json({
			success: true,
			...result
		});
	} catch (err) {
		console.error("Get Reviews Error:", err);
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
    await ratingService.deleteReview(reviewId, req.user._id);

		return res
			.status(200)
			.json({ success: true, message: "Review deleted successfully" });
	} catch (err) {
		console.error("Delete Review Error:", err);
    const status = err.message.includes("not found") ? 404 : 
                   err.message.includes("only delete your own") ? 403 : 500;

		return res.status(status).json({
			success: false,
			message: err.message || "Error deleting review",
		});
	}
};

module.exports = {
	rateFood: (req, res) =>
		rateEntity({ req, res, targetType: "FoodItem" }),
	rateCombo: (req, res) =>
		rateEntity({ req, res, targetType: "Combo" }),
	rateVendor: (req, res) =>
		rateEntity({ req, res, targetType: "Vendor" }),
	rateRider: (req, res) =>
		rateEntity({ req, res, targetType: "Rider" }),
	getReviews,
	deleteReview,
};
