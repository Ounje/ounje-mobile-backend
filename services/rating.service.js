const mongoose = require("mongoose");
const { Types } = mongoose;
const {
	Rating,
	Order,
	FoodItem,
	Combo,
	Vendor,
	Rider,
} = require("../models");
const logger = require("../utils/logger");

class RatingService {
	constructor() {
		this.models = {
			FoodItem,
			Combo,
			Vendor,
			Rider,
		};
		this.collectionNames = {
			//Vendor: "users",
			Rider: "users",
		};
	}

	// Safe ObjectId conversion
	toObjectId(id) {
		return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
	}

	async rateEntity(customerId, targetType, targetId, { rating, comment }) {
		const Model = this.models[targetType];
		if (!Model) {
			logger.error(`RatingService: Invalid target type ${targetType}`);
			throw new Error(`Invalid target type: ${targetType}`);
		}

		if (!this.toObjectId(targetId)) {
			logger.error(`RatingService: Invalid target ID ${targetId}`);
			throw new Error("Invalid target ID");
		}

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
			);
		}

		// Return updated stats
		const updatedTarget = await Model.findById(targetId);
		logger.info(`Entity rated: ${targetType} ${targetId} by Customer ${customerId}`);
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
	) {
		if (rating !== undefined && (rating < 1 || rating > 5)) {
			throw new Error("Rating must be between 1 and 5");
		}

		const canRate = await this.hasCompletedOrder({
			customerId,
			targetType,
			targetId,
			target,
		});

		if (!canRate) {
			throw new Error(
				`You can only rate a ${targetType} after completing a relevant order.`,
			);
		}

		const updateData = {};
		if (rating !== undefined) updateData.rating = rating;
		if (comment !== undefined) updateData.comment = comment;

		if (Object.keys(updateData).length === 0) {
			throw new Error("Please provide a rating or comment");
		}

		await Rating.findOneAndUpdate(
			{ targetType, target: targetId, customer: customerId },
			updateData,
			{
				upsert: true,
				new: true,
				runValidators: true,
				setDefaultsOnInsert: true,
			},
		);

		await this.updateEntityRatingStats(
			targetType,
			targetId,
			this.models[targetType],
		);
	}

	async updateEntityRatingStats(targetType, targetId, Model) {
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

		// Update target model with new stats
		await Model.findByIdAndUpdate(targetId, {
			averageRating: avg,
			ratingCount: count,
		});

		return { averageRating: avg, totalRatings: count };
	}

	async hasCompletedOrder({ customerId, targetType, targetId, target }) {
		const query = {
			status: "DELIVERED",
			customer: this.toObjectId(customerId),
		};

		const tId = this.toObjectId(targetId);

		switch (targetType) {
			case "Vendor":
				// Check for orders from this vendor
				query.vendor = tId;
				break;
			case "Rider":
				// Check for orders delivered by this rider
				query.rider = tId;
				break;
			case "FoodItem":
			case "Combo":
				// Check for orders containing this item
				query["items.item"] = tId;
				query["items.itemType"] = targetType;
				break;
			default:
				return false;
		}

		const exists = await Order.exists(query);
		return !!exists;
	}

	// Expose for usage in deleteReview or other places if needed
	async updateAverage(targetType, targetId) {
		const Model = this.models[targetType];
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

		const validTypes = Object.keys(this.models);
		if (!validTypes.includes(targetType)) {
			throw new Error(
				`Invalid target type. Must be one of: ${validTypes.join(", ")}`,
			);
		}

		const Model = this.models[targetType];
		const targetEntity = await Model.findById(targetId).select(
			"averageRating ratingCount",
		);

		if (!targetEntity) {
			throw new Error(`${targetType} not found`);
		}

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
		const review = await Rating.findById(reviewId);
		if (!review) {
			throw new Error("Review not found");
		}

		if (userId && !review.customer.equals(userId)) {
			throw new Error("You can only delete your own reviews");
		}

		await review.deleteOne();

		const Model = this.models[review.targetType];
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

		const leaderboard = await Rating.aggregate([
			{
				$match: {
					targetType: "Rider",
					createdAt: { $gte: fourteenDaysAgo },
				},
			},
			{
				$group: {
					_id: "$target",
					averageRating: { $avg: "$rating" },
					totalRatings: { $sum: 1 },
				},
			},
		]);

		for (const rider of leaderboard) {
			await Rider.findByIdAndUpdate(rider._id, {
				averageRating: rider.averageRating,
				ratingCount: rider.totalRatings,
			});
		}

		const leaderboardWithRiderInfo = await Rating.aggregate([
			{
				$match: {
					targetType: "Rider",
					createdAt: { $gte: fourteenDaysAgo },
				},
			},
			{
				$group: {
					_id: "$target",
					averageRating: { $avg: "$rating" },
					totalRatings: { $sum: 1 },
				},
			},
			{
				$lookup: {
					from: "users",
					localField: "_id",
					foreignField: "_id",
					as: "rider",
				},
			},
			{ $unwind: "$rider" },
			{ $match: { "rider.role": "rider" } },
			{ $sort: { averageRating: -1, totalRatings: -1 } },
			{ $limit: 5 },
			{
				$project: {
					rider: { _id: "$rider._id", name: "$rider.name" },
					averageRating: { $round: ["$averageRating", 2] },
					totalRatings: 1,
				},
			},
		]);

		return {
			success: true,
			count: leaderboardWithRiderInfo.length,
			data: leaderboardWithRiderInfo,
		};
	}
}

module.exports = new RatingService();
