const mongoose = require("mongoose");
const { Types } = mongoose;
const logger = require("../utils/logger");

class RatingService {
	constructor() {
		this.collectionNames = {
			//Vendor: "users",
			Rider: "users",
		};
	}

	getModel(targetType) {
		try {
			if (targetType === "Vendor") return mongoose.model("VendorProfile");
			if (targetType === "Rider") return mongoose.model("RiderProfile");
			return mongoose.model(targetType);
		} catch (error) {
			logger.error(`Error getting model for ${targetType}: ${error.message}`);
			return null;
		}
	}

	// Safe ObjectId conversion
	toObjectId(id) {
		return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
	}

	async rateEntity(customerId, targetType, targetId, { rating, comment, orderId }) {
		const Model = this.getModel(targetType);
		if (!Model) {
			logger.error(`RatingService: Invalid target type ${targetType}`);
			throw new Error(`Invalid target type: ${targetType}`);
		}

		if (!this.toObjectId(targetId)) {
			logger.error(`RatingService: Invalid target ID ${targetId}`);
			throw new Error("Invalid target ID");
		}

		// targetId is now expected to be the Profile ID (for Vendor/Rider) or Item ID
		const target = await Model.findById(targetId);
		if (!target) {
			throw new Error(`${targetType} not found`);
		}

		// Handle Ratings & Comments
		if (rating !== undefined || comment !== undefined) {
			await this.handleRating(
				customerId,
				targetType,
				targetId,
				target,
				rating,
				comment,
				orderId,
			);
		}

		// Return updated stats
		const updatedTarget = await Model.findById(targetId);
		logger.info(
			`Entity rated: ${targetType} ${targetId} by Customer ${customerId}`,
		);
		return {
			averageRating: updatedTarget.averageRating || 0,
			totalRatings: updatedTarget.ratingCount || 0,
		};
	}

	async handleRating(
		customerId,
		targetType,
		targetId,
		target,
		rating,
		comment,
		orderId,
	) {
		if (rating !== undefined && (rating < 1 || rating > 5)) {
			throw new Error("Rating must be between 1 and 5");
		}

		if (!orderId) {
			throw new Error("orderId is required to submit a rating");
		}

		const canRate = await this.hasCompletedOrder({
			customerId,
			targetType,
			targetId,
			target,
			orderId,
		});

		if (!canRate) {
			throw new Error(
				`You can only rate a ${targetType} after completing a relevant order.`,
			);
		}

		if (rating === undefined) {
			throw new Error("Please provide a rating");
		}

		const Rating = mongoose.model("Rating");

		// One rating per customer per entity per order — upsert so re-submission updates
		await Rating.findOneAndUpdate(
			{ targetType, target: targetId, customer: customerId, orderId },
			{ rating, ...(comment !== undefined ? { comment } : {}) },
			{
				upsert: true,
				new: true,
				runValidators: true,
				setDefaultsOnInsert: true,
			},
		);

		await this.updateEntityRatingStats(targetType, targetId, this.getModel(targetType));
	}

	async updateEntityRatingStats(targetType, targetId, Model) {
		const Rating = mongoose.model("Rating");
		const stats = await Rating.aggregate([
			{ $match: { targetType, target: this.toObjectId(targetId) } },
			{
				$group: {
					_id: "$target",
					avg: { $avg: "$rating" },
					count: { $sum: 1 },
				},
			},
		]);

		const { avg = 0, count = 0 } = stats[0] || {};

		const updateData = {};
		updateData.averageRating = avg;
		updateData.ratingCount = count;

		// BACKWARD COMPATIBILITY
		// For RiderProfile: update nested fields
		if (targetType === "Rider") {
			updateData["ratings.average"] = avg;
			updateData["ratings.count"] = count;
		}
		// For VendorProfile: keep 'rating' in sync
		if (targetType === "Vendor") {
			updateData.rating = avg;
		}
		// Plate: 'rating' was used before standardizing, keep it synced if needed, but averageRating is now source of truth
		if (targetType === "Plate") {
			updateData.rating = avg;
		}


		// Update target model with new stats
		await Model.findByIdAndUpdate(targetId, updateData);

		return { averageRating: avg, totalRatings: count };
	}

	async hasCompletedOrder({ customerId, targetType, targetId, target, orderId }) {
		const Order = mongoose.model("Order");

		// If orderId is provided, just verify this specific order was delivered and
		// belongs to the correct vendor/rider — fastest and most precise check.
		if (orderId) {
			const order = await Order.findById(orderId).select(
				"status customer vendor rider",
			);
			if (!order) return false;
			if (order.status !== "delivered") return false;
			if (order.customer.toString() !== customerId.toString()) return false;

			const tId = this.toObjectId(targetId);
			if (targetType === "Vendor") {
				return order.vendor && order.vendor.toString() === tId.toString();
			}
			if (targetType === "Rider") {
				// Order.rider stores RiderProfile _id
				return order.rider && order.rider.toString() === tId.toString();
			}
			// For FoodItem / Combo / Plate — trust that orderId was delivered
			return true;
		}

		// Fallback: scan all completed orders (used when orderId is not supplied)
		const query = {
			status: "delivered",
			customer: this.toObjectId(customerId),
		};
		const tId = this.toObjectId(targetId);

		switch (targetType) {
			case "Vendor":
				query.vendor = tId;
				break;
			case "Rider":
				query.rider = tId;
				break;
			case "FoodItem":
			case "Combo":
			case "Plate":
				query["items.item"] = tId;
				query["items.itemType"] = targetType;
				break;
			default:
				return false;
		}

		const exists = await Order.exists(query);
		return !!exists;
	}

	// Check whether a customer has already rated an order (vendor + rider)
	async checkOrderRating(customerId, orderId) {
		const Rating = mongoose.model("Rating");
		const ratings = await Rating.find({
			customer: this.toObjectId(customerId),
			orderId: this.toObjectId(orderId),
		}).select("targetType").lean();

		return {
			vendorRated: ratings.some((r) => r.targetType === "Vendor"),
			riderRated: ratings.some((r) => r.targetType === "Rider"),
			fullyRated: ratings.some((r) => r.targetType === "Vendor") && ratings.some((r) => r.targetType === "Rider"),
		};
	}

	// Expose for usage in deleteReview or other places if needed
	async updateAverage(targetType, targetId) {
		const Model = this.getModel(targetType);
		if (Model) {
			return this.updateEntityRatingStats(targetType, targetId, Model);
		}
		return { avg: 0, count: 0 };
	}

	async getReviews(targetType, targetId, { page = 1, limit = 10 }) {
		if (!this.toObjectId(targetId)) {
			logger.error(`GetReviews: Invalid target ID ${targetId}`);
			throw new Error("Invalid target ID");
		}

		const validTypes = ["FoodItem", "Combo", "Vendor", "Rider", "Plate"];
		if (!validTypes.includes(targetType)) {
			throw new Error(
				`Invalid target type. Must be one of: ${validTypes.join(", ")}`,
			);
		}

		const Model = this.getModel(targetType);
		const targetEntity = await Model.findById(targetId).select(
			"averageRating ratingCount",
		);

		if (!targetEntity) {
			throw new Error(`${targetType} not found`);
		}

		page = parseInt(page);
		limit = Math.min(parseInt(limit), 50);

		const filter = { targetType, target: targetId };

		const Rating = mongoose.model("Rating");
		const [reviews, total] = await Promise.all([
			Rating.find(filter)
				.populate("customer", "name img")
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean(),
			Rating.countDocuments(filter),
		]);

		const breakdown = await Rating.aggregate([
			{ $match: { targetType, target: this.toObjectId(targetId) } },
			{ $group: { _id: "$rating", count: { $sum: 1 } } },
			{ $sort: { _id: -1 } },
		]);

		return {
			data: reviews,
			summary: {
				averageRating: targetEntity.averageRating || 0,
				totalRatings: targetEntity.ratingCount || 0,
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
		};
	}

	async deleteReview(reviewId, userId) {
		const Rating = mongoose.model("Rating");
		const review = await Rating.findById(reviewId);
		if (!review) {
			throw new Error("Review not found");
		}

		if (userId && !review.customer.equals(userId)) {
			throw new Error("You can only delete your own reviews");
		}

		await review.deleteOne();

		const Model = this.getModel(review.targetType);
		if (Model) {
			await this.updateEntityRatingStats(
				review.targetType,
				review.target,
				Model,
			);
		}
		logger.info(`Review ${reviewId} deleted by User ${userId}`);
	}
	async getRiderLeaderboard() {
		const fourteenDaysAgo = new Date();
		fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

		const Rating = mongoose.model("Rating");
		// Aggregate ratings on Profile ID directly
		const leaderboard = await Rating.aggregate([
			{
				$match: {
					targetType: "Rider",
					createdAt: { $gte: fourteenDaysAgo },
				},
			},
			{
				$group: {
					_id: "$target", // usage of Profile ID
					averageRating: { $avg: "$rating" },
					totalRatings: { $sum: 1 },
				},
			},
		]);

		// Update stats for all riders in leaderboard
		for (const riderStat of leaderboard) {
			// Check if rider still exists and is valid
			const Rider = mongoose.model("RiderProfile");
			const riderProfile = await Rider.findById(riderStat._id);
			if (riderProfile) {
				// We reuse updateEntityRatingStats to ensure consistency
				await this.updateEntityRatingStats("Rider", riderStat._id, Rider);
			}
		}

		// Re-fetch sorted leaderboard with user details
		const RiderProfile = mongoose.model("RiderProfile");
		const leaderboardWithRiderInfo = await RiderProfile.aggregate([
			{
				$lookup: {
					from: "users",
					localField: "user",
					foreignField: "_id",
					as: "userInfo",
				},
			},
			{ $unwind: "$userInfo" },
			{
				$project: {
					riderId: "$userInfo._id",
					name: "$userInfo.name",
					rank: { $ifNull: ["$rank", "New Rider"] },
					totalDeliveries: { $ifNull: ["$totalDeliveries", 0] },
					rating: {
						$ifNull: [
							"$ratings.average",
							{ $ifNull: ["$averageRating", 0] },
						],
					},
					ratingCount: {
						$ifNull: ["$ratings.count", { $ifNull: ["$ratingCount", 0] }],
					},
				},
			},
			{ $sort: { totalDeliveries: -1, rating: -1 } },
		]);

		// Let's stick to the existing aggregation on Rating but just add the fields.

		const ratingLeaderboard = await Rating.aggregate([
			{
				$match: {
					targetType: "Rider",
					createdAt: { $gte: fourteenDaysAgo },
				},
			},
			{
				$group: {
					_id: "$target", // Profile ID
					averageRating: { $avg: "$rating" },
					totalRatings: { $sum: 1 },
				},
			},
			{
				$lookup: {
					from: "riderprofiles",
					localField: "_id",
					foreignField: "_id",
					as: "profile",
				},
			},
			{ $unwind: "$profile" },
			{
				$lookup: {
					from: "users",
					localField: "profile.user",
					foreignField: "_id",
					as: "user",
				},
			},
			{ $unwind: "$user" },
			{ $match: { "user.role": "rider" } },
			{ $sort: { averageRating: -1, totalRatings: -1 } },
			{ $limit: 10 },
			{
				$project: {
					_id: 0,
					riderId: "$user._id",
					name: "$user.name",
					rank: { $ifNull: ["$profile.rank", "New Rider"] },
					totalDeliveries: { $ifNull: ["$profile.totalDeliveries", 0] },
					rating: { $round: ["$averageRating", 2] },
				},
			},
		]);

		return {
			success: true,
			count: ratingLeaderboard.length,
			data: ratingLeaderboard,
		};
	}
}

module.exports = new RatingService();
