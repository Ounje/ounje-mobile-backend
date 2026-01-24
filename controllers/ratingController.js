const ratingService = require("../services/rating.service");

// Main handler for rating & likes
const rateEntity = async ({ req, res, targetType }) => {
	try {
    const { rating, comment, like } = req.body;
		const result = await ratingService.rateEntity(
			req.user._id,
			targetType,
			req.params.id,
			{ rating, comment, like }
		);

		return res.status(200).json({
			success: true,
			message: "Your feedback was successfully recorded",
			data: result,
		});
	} catch (err) {
		console.error(`Rate ${targetType} Error:`, err);
		// Determine status code based on error message or type if strict specific error handling needed
		// For now generic 400 for input errors, 500 for server
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
