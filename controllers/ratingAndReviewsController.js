const Food = require("../models/FoodItem");
const Combo = require("../models/Combo");
const Vendor = require("../models/Vendor");
const Rider = require("../models/Rider");
const Order = require("../models/Order");
const Rating = require("../models/Rating");
const { updateAverage } = require("../services/rating.service");

const hasCompletedOrder = async (query) =>
	Order.exists({ status: "completed", ...query });

const rateEntity = async ({ req, res, targetType, model, itemMatch }) => {
	const { rating, comment, like } = req.body;
	const targetId = req.params.id;

	if (req.user.role !== "customer") {
		return res.status(403).json({ message: "Customers only" });
	}

	const target = await model.findById(targetId);
	if (!target) return res.status(404).json({ message: "Not found" });

	/* LIKE */
	if (like === true && target.likes) {
		if (!target.likes.includes(req.user._id)) {
			target.likes.push(req.user._id);
			await target.save();
		}
	}

	/* RATING */
	if (rating || comment) {
		const completed = await hasCompletedOrder({
			customer: req.user._id,
			...itemMatch(targetId),
		});

		if (!completed) {
			return res.status(403).json({
				message: "Rating requires completed order",
			});
		}

		await Rating.findOneAndUpdate(
			{
				targetType,
				target: targetId,
				customer: req.user._id,
			},
			{ rating, comment },
			{ upsert: true, new: true, runValidators: true },
		);

		const { avg, count } = await updateAverage(targetType, target._id);

		target.ratingAverage = avg;
		target.ratingCount = count;
		await target.save();
	}

	res.json({ message: "Success" });
};

const getReviews = async (req, res) => {
	try {
		const { targetType, targetId } = req.params;
		let { page = 1, limit = 10 } = req.query;

		page = parseInt(page);
		limit = Math.min(parseInt(limit), 50);

		const filter = {
			targetType,
			target: targetId,
		};

		const [reviews, total] = await Promise.all([
			Rating.find(filter)
				.populate("customer")
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean(),

			Rating.countDocuments(filter),
		]);

		res.status(200).json({
			data: reviews,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
				hasNextPage: page * limit < total,
				hasPrevPage: page > 1,
			},
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

/* EXPORTS */

module.exports = {
	rateFood: (req, res) =>
		rateEntity({
			req,
			res,
			targetType: "FoodItem",
			model: Food,
			itemMatch: (id) => ({
				items: {
					$elemMatch: { itemType: "FoodItem", item: id },
				},
			}),
		}),

	rateCombo: (req, res) =>
		rateEntity({
			req,
			res,
			targetType: "Combo",
			model: Combo,
			itemMatch: (id) => ({
				items: {
					$elemMatch: { itemType: "Combo", item: id },
				},
			}),
		}),

	rateVendor: (req, res) =>
		rateEntity({
			req,
			res,
			targetType: "Vendor",
			model: Vendor,
			itemMatch: (id) => ({ vendor: id }),
		}),

	rateRider: (req, res) =>
		rateEntity({
			req,
			res,
			targetType: "Rider",
			model: Rider,
			itemMatch: (id) => ({ rider: id }),
		}),
	getReviews,
};
