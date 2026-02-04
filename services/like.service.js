const mongoose = require("mongoose");
const { Types } = mongoose;
const { FoodItem, Combo, Vendor, Rider } = require("../models");

class LikeService {
	constructor() {
		this.models = {
			FoodItem,
			Combo,
			Vendor,
			Rider,
		};
	}

	// Safe ObjectId conversion
	toObjectId(id) {
		return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
	}

	async toggleLike(customerId, targetType, targetId, likeStatus) {
		const Model = this.models[targetType];
		if (!Model) {
			throw new Error(`Invalid target type: ${targetType}`);
		}

		if (!this.toObjectId(targetId)) {
			throw new Error("Invalid target ID");
		}

		const target = await Model.findById(targetId);
		if (!target) {
			throw new Error(`${targetType} not found`);
		}


		// likeStatus: true = like, false = unlike
		console.log(`[LikeService] Toggling like: User ${customerId} -> ${targetType} ${targetId} (Like: ${likeStatus})`);

		if (likeStatus === true) {
			await Model.findByIdAndUpdate(targetId, {
				$addToSet: { likes: customerId },
			});
		} else if (likeStatus === false) {
			await Model.findByIdAndUpdate(targetId, {
				$pull: { likes: customerId },
			});
		}

		const updatedTarget = await Model.findById(targetId);
		console.log(`[LikeService] Updated likes count: ${updatedTarget.likes ? updatedTarget.likes.length : 0}`);

		return {
			likes: updatedTarget.likes ? updatedTarget.likes.length : 0,
		};
	}
}

module.exports = new LikeService();
