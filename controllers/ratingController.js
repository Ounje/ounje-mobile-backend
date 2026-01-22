const mongoose = require("mongoose");
const { Types } = mongoose;
const FoodItem = require("../models/FoodItem");
const Combo = require("../models/Combo");
const Vendor = require("../models/Vendor");
const Rider = require("../models/Rider");
const Order = require("../models/Order");
const Rating = require("../models/Rating");
const { updateAverage } = require("../services/rating.service");

// Safe ObjectId conversion
const toObjectId = (id) =>
	id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;

// Check if customer has a completed order
const hasCompletedOrder = async ({
	customerId,
	vendorId,
	riderId,
	targetId,
	targetType,
}) => {
	const query = { status: "completed", customer: toObjectId(customerId) };

	switch (targetType) {
		case "Vendor":
			if (!vendorId) return false;
			query.vendor = toObjectId(vendorId);
			break;
		case "Rider":
			if (!riderId) return false;
			query.rider = toObjectId(riderId);
			break;
		case "FoodItem":
		case "Combo":
			if (!targetId) return false;
			query["items.item"] = toObjectId(targetId);
			query["items.itemType"] = targetType;
			break;
		default:
			return false;
	}

	return !!(await Order.exists(query));
};

// Main handler for rating & likes
const rateEntity = async ({ req, res, targetType, model }) => {
	try {
		const targetId = toObjectId(req.params.id);
		if (!targetId)
			return res
				.status(400)
				.json({ success: false, message: "Invalid target ID" });
		if (req.user.role !== "customer")
			return res
				.status(403)
				.json({ success: false, message: "Only customers can rate or like" });

		const target = await model.findById(targetId);
		if (!target)
			return res
				.status(404)
				.json({ success: false, message: `${targetType} not found` });

		// Ensure likes array exists and clean invalid entries
		if (!Array.isArray(target.likes)) target.likes = [];
		target.likes = target.likes.filter((id) => id != null);

		const { rating, comment, like } = req.body;

		// LIKE
		if (like === true) {
			if (!target.likes.some((id) => id.equals(req.user._id))) {
				target.likes.push(req.user._id);
				await target.save();
			}
		}

		// UNLIKE
		if (like === false) {
			target.likes = target.likes.filter((id) => !id.equals(req.user._id));
			await target.save();
		}

		// RATING & COMMENT
		if (rating !== undefined || comment) {
			if (rating !== undefined && (rating < 1 || rating > 5))
				return res
					.status(400)
					.json({ success: false, message: "Rating must be between 1 and 5" });

			const completed = await hasCompletedOrder({
				customerId: req.user._id,
				vendorId: targetType === "Vendor" ? targetId : target.vendor,
				riderId: targetType === "Rider" ? targetId : null,
				targetId,
				targetType,
			});

			if (!completed)
				return res.status(403).json({
					success: false,
					message:
						targetType === "Vendor"
							? "You can only rate a vendor after completing an order from them"
							: targetType === "Rider"
								? "You can only rate a rider after delivery"
								: `You can only rate a ${targetType} after completing an order containing it`,
				});

			const updateData = {};
			if (rating !== undefined) updateData.rating = rating;
			if (comment !== undefined) updateData.comment = comment;

			if (Object.keys(updateData).length === 0)
				return res.status(400).json({
					success: false,
					message: "Please provide a rating or comment",
				});

			await Rating.findOneAndUpdate(
				{ targetType, target: targetId, customer: req.user._id },
				updateData,
				{
					upsert: true,
					new: true,
					runValidators: true,
					setDefaultsOnInsert: true,
				},
			);

			const { avg, count } = await updateAverage(targetType, targetId);

			if ("averageRating" in target) target.averageRating = avg;
			if ("rating" in target) target.rating = avg;
			if ("totalRatings" in target) target.totalRatings = count;
			if ("ratingCount" in target) target.ratingCount = count;

			await target.save();
		}

		return res.status(200).json({
			success: true,
			message: "Your feedback was successfully recorded",
			data: {
				likes: target.likes.length,
				averageRating: target.averageRating || target.rating || 0,
				totalRatings: target.totalRatings || target.ratingCount || 0,
			},
		});
	} catch (err) {
		console.error(`Rate ${targetType} Error:`, err);
		return res.status(500).json({
			success: false,
			message: "Error processing feedback",
			error: err.message,
		});
	}
};

// Get reviews
const getReviews = async (req, res) => {
	try {
		const targetId = toObjectId(req.params.targetId);
		if (!targetId)
			return res
				.status(400)
				.json({ success: false, message: "Invalid target ID" });

		const { targetType } = req.params;
		const validTypes = ["FoodItem", "Combo", "Vendor", "Rider"];
		if (!validTypes.includes(targetType))
			return res.status(400).json({
				success: false,
				message: `Invalid target type. Must be one of: ${validTypes.join(", ")}`,
			});

		let { page = 1, limit = 10 } = req.query;
		page = parseInt(page);
		limit = Math.min(parseInt(limit), 50);

		const filter = { targetType, target: targetId };

		const [reviews, total] = await Promise.all([
			Rating.find(filter)
				.populate("customer", "name img")
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean(),
			Rating.countDocuments(filter),
		]);

		const ratingSummary = await Rating.aggregate([
			{ $match: { targetType, target: targetId } },
			{
				$group: { _id: null, average: { $avg: "$rating" }, total: { $sum: 1 } },
			},
		]);

		const breakdown = await Rating.aggregate([
			{ $match: { targetType, target: targetId } },
			{ $group: { _id: "$rating", count: { $sum: 1 } } },
			{ $sort: { _id: -1 } },
		]);

		return res.status(200).json({
			success: true,
			data: reviews,
			summary: {
				averageRating: ratingSummary[0]?.average || 0,
				totalRatings: ratingSummary[0]?.total || 0,
				ratingBreakdown: breakdown.reduce((acc, cur) => {
					acc[`${cur._id}star`] = cur.count;
					return acc;
				}, {}),
			},
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
				hasNextPage: page * limit < total,
				hasPrevPage: page > 1,
			},
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
		const review = await Rating.findById(reviewId);
		if (!review)
			return res
				.status(404)
				.json({ success: false, message: "Review not found" });
		if (!review.customer.equals(req.user._id))
			return res.status(403).json({
				success: false,
				message: "You can only delete your own reviews",
			});

		await review.deleteOne();

		const { avg, count } = await updateAverage(
			review.targetType,
			review.target,
		);
		const targetModel = { FoodItem, Combo, Vendor, Rider }[review.targetType];
		const target = await targetModel.findById(review.target);
		if (target) {
			if ("averageRating" in target) target.averageRating = avg;
			if ("rating" in target) target.rating = avg;
			if ("totalRatings" in target) target.totalRatings = count;
			if ("ratingCount" in target) target.ratingCount = count;
			await target.save();
		}

		return res
			.status(200)
			.json({ success: true, message: "Review deleted successfully" });
	} catch (err) {
		console.error("Delete Review Error:", err);
		return res.status(500).json({
			success: false,
			message: "Error deleting review",
			error: err.message,
		});
	}
};

module.exports = {
	rateFood: (req, res) =>
		rateEntity({ req, res, targetType: "FoodItem", model: FoodItem }),
	rateCombo: (req, res) =>
		rateEntity({ req, res, targetType: "Combo", model: Combo }),
	rateVendor: (req, res) =>
		rateEntity({ req, res, targetType: "Vendor", model: Vendor }),
	rateRider: (req, res) =>
		rateEntity({ req, res, targetType: "Rider", model: Rider }),
	getReviews,
	deleteReview,
};
