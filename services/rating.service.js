const Rating = require("../models/Rating");

const updateAverage = async (targetType, targetId) => {
	const stats = await Rating.aggregate([
		{ $match: { targetType, target: targetId } },
		{
			$group: {
				_id: "$target",
				avg: { $avg: "$rating" },
				count: { $sum: 1 },
			},
		},
	]);

	return stats[0] || { avg: 0, count: 0 };
};

module.exports = { updateAverage };
