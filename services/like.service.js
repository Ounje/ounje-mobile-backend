const mongoose = require("mongoose");
const logger = require("../utils/logger");

/**
 * Like Service
 * Handles like/unlike functionality for various entity types
 * 
 * IMPORTANT: This service should work with Profile IDs for Vendor/Rider
 * (The controller already converts User IDs to Profile IDs before calling this service)
 */

class LikeService {
	/**
	 * Toggle like/unlike for an entity
	 * @param {String} customerId - User ID of the customer
	 * @param {String} targetType - Type: FoodItem, Combo, Vendor, Rider
	 * @param {String} targetId - ID of the entity (Profile ID for Vendor/Rider)
	 * @param {Boolean} like - true to like, false to unlike
	 */
	async toggleLike(customerId, targetType, targetId, like) {
		try {
			// Validate target type
			const validTypes = ['FoodItem', 'Combo', 'Vendor', 'Rider', 'Plate'];
			if (!validTypes.includes(targetType)) {
				logger.error(`Invalid target type for like: ${targetType}`);
				throw new Error(`Invalid target type: ${targetType}. Must be one of: ${validTypes.join(', ')}`);
			}

			// Verify the entity exists
			const Model = this.getModel(targetType);
			if (!Model) {
				throw new Error(`Model not found for target type: ${targetType}`);
			}

			const entity = await Model.findById(targetId);
			if (!entity) {
				throw new Error(`${targetType} not found`);
			}

			const Like = mongoose.model("Like");

			if (like) {
				// Add like
				await Like.findOneAndUpdate(
					{ targetType, target: targetId, customer: customerId },
					{ targetType, target: targetId, customer: customerId },
					{ upsert: true, new: true, setDefaultsOnInsert: true }
				);
				logger.info(`User ${customerId} liked ${targetType} ${targetId}`);
			} else {
				// Remove like
				await Like.findOneAndDelete({
					targetType,
					target: targetId,
					customer: customerId,
				});
				logger.info(`User ${customerId} unliked ${targetType} ${targetId}`);
			}

			// Count total likes for this entity
			const likeCount = await Like.countDocuments({
				targetType,
				target: targetId,
			});

			// Write the count back to the denormalized field on the entity
			await Model.findByIdAndUpdate(targetId, { likes: likeCount });

			return {
				liked: like,
				totalLikes: likeCount,
			};
		} catch (error) {
			logger.error(`LikeService.toggleLike error: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get the mongoose model for a target type
	 */
	getModel(targetType) {
		try {
			if (targetType === 'Vendor') return mongoose.model('VendorProfile');
			if (targetType === 'Rider') return mongoose.model('RiderProfile');
			return mongoose.model(targetType);
		} catch (error) {
			logger.error(`Error getting model for ${targetType}: ${error.message}`);
			return null;
		}
	}

	/**
	 * Check if a user has liked an entity
	 * @param {String} customerId - User ID
	 * @param {String} targetType - Entity type
	 * @param {String} targetId - Entity ID (Profile ID for Vendor/Rider)
	 */
	async hasLiked(customerId, targetType, targetId) {
		try {
			const Like = mongoose.model("Like");
			const like = await Like.findOne({
				targetType,
				target: targetId,
				customer: customerId,
			});
			return !!like;
		} catch (error) {
			logger.error(`LikeService.hasLiked error: ${error.message}`);
			return false;
		}
	}

	/**
	 * Get all likes for an entity
	 * @param {String} targetType - Entity type
	 * @param {String} targetId - Entity ID (Profile ID for Vendor/Rider)
	 */
	async getLikes(targetType, targetId) {
		try {
			const Like = mongoose.model("Like");
			const likes = await Like.find({ targetType, target: targetId })
				.populate('customer', 'name img')
				.lean();

			return {
				totalLikes: likes.length,
				likes: likes,
			};
		} catch (error) {
			logger.error(`LikeService.getLikes error: ${error.message}`);
			throw error;
		}
	}
}

module.exports = new LikeService();
