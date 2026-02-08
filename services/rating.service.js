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

	async rateEntity(customerId, targetType, targetId, { rating, comment }) {
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

		const Rating = mongoose.model("Rating");
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

		const updateData = {
			averageRating: avg,
			ratingCount: count,
		};

		// For RiderProfile, update nested fields as well for backward compatibility
		if (targetType === "Rider") {
			updateData["ratings.average"] = avg;
			updateData["ratings.count"] = count;
		}
		// For VendorProfile, check if 'rating' field is used for average
		if (targetType === "Vendor") {
			updateData.rating = avg;
		}

		// Update target model with new stats
		await Model.findByIdAndUpdate(targetId, updateData);

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
				// Check for orders from this vendor (Order.vendor is VendorProfile ID)
				query.vendor = tId;
				break;
			case "Rider":
				// Check for orders delivered by this rider (Order.rider is User ID, usually?)
				// Wait, typically Order.rider stores the RiderProfile ID in a clean schema,
				// BUT the user instructions explicitly said:
				// "Check if your Order model stores rider as User ID (not Profile ID)"
				// And in `models/Order.js` we see: rider: { type: mongoose.Schema.Types.ObjectId, ref: "RiderProfile" }
				// PROCEEDING WITH USER INSTRUCTION AS PRIORITY, but noting conflict.
				// The user said: "For Riders: Order.exists({ rider: riderUserId })"
				// So let's use target.user if available.

				if (target && target.user) {
					query.rider = target.user; // Assuming Order.rider matches RiderProfile.user (User ID)
				} else {
					// Fallback to profile ID if target.user isn't available (shouldn't happen for RiderProfile)
					query.rider = tId;
				}
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

		const Order = mongoose.model("Order");
		const exists = await Order.exists(query);
		return !!exists;
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

		const validTypes = ["FoodItem", "Combo", "Vendor", "Rider"];
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
		// We know that _id in Rating is now RiderProfile ID.
		// We need to lookup RiderProfile first, then look up "User" from RiderProfile.user

		// However, standard $lookup from Rating directly to User won't work easily if Rating.target is ProfileID and User is separate.
		// We need: Rating (target=ProfileId) -> RiderProfile (_id=ProfileId, user=UserId) -> User (_id=UserId)

		const leaderboardWithRiderInfo = await Rating.aggregate([
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
			// Lookup RiderProfile
			{
				$lookup: {
					from: "riderprofiles", // Make sure collection name is correct (usually lowercase plural)
					// If unsure, we can try to rely on mongoose model name conventions, usually "riderprofiles" or similar. 
					// Let's assume standard mongoose naming: RiderProfile -> riderprofiles (or riders?)
					// Inspecting models/RiderProfile.js doesn't show collection name explicitly, so default is 'riderprofiles'.
					localField: "_id",
					foreignField: "_id",
					as: "profile"
				}
			},
			{ $unwind: "$profile" },
			// Lookup User from RiderProfile
			{
				$lookup: {
					from: "users",
					localField: "profile.user",
					foreignField: "_id",
					as: "user"
				}
			},
			{ $unwind: "$user" },
			{ $match: { "user.role": "rider" } },
			{ $sort: { averageRating: -1, totalRatings: -1 } },
			{ $limit: 5 },
			{
				$project: {
					rider: { _id: "$user._id", name: "$user.name", profileId: "$profile._id" },
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
