const { VendorProfile, Combo, Plate, FoodItem } = require("../models");
const logger = require("../utils/logger");

const measurePerformance = (label) => {
	const start = process.hrtime.bigint();
	return () => {
		const end = process.hrtime.bigint();
		const duration = Number(end - start) / 1_000_000;
		logger.info(`${label}: ${duration.toFixed(2)}ms`);
		return duration;
	};
};

const searchVendors = async (query, limit, includeUnavailable) => {
	try {
		const foodVendors = await FoodItem.aggregate([
			{ $match: { $text: { $search: query }, isAvailable: true } },
			{ $group: { _id: "$vendor" } },
		]);
		const vendorIdsFromFood = foodVendors.map((v) => v._id);

		const matchStage = {
			$or: [{ _id: { $in: vendorIdsFromFood } }, { $text: { $search: query } }],
		};
		if (!includeUnavailable) matchStage.isActive = true;

		const vendors = await VendorProfile.aggregate([
			{ $match: matchStage },
			{
				$project: {
					type: { $literal: "vendor" },
					id: "$_id",
					name: 1,
					image: { $ifNull: ["$logoUrl", "$profileImage", "$bannerUrl"] },
					isOpen: "$isActive",
					averageRating: { $ifNull: ["$averageRating", 0] },
					totalRating: { $ifNull: ["$ratingCount", 0] },
					_id: 0,
				},
			},
			{ $limit: limit },
		]).allowDiskUse(true);

		return vendors;
	} catch (err) {
		logger.error(`Vendor search error: ${err.message}`);
		return [];
	}
};

const searchFoodItems = async (query, limit, includeUnavailable) => {
	try {
		const matchStage = { $text: { $search: query } };
		if (!includeUnavailable) matchStage.isAvailable = true;

		const foods = await FoodItem.aggregate([
			{ $match: matchStage },
			{
				$lookup: {
					from: "vendorprofiles",
					localField: "vendor",
					foreignField: "_id",
					as: "vendorInfo",
				},
			},
			{ $unwind: "$vendorInfo" },
			{
				$project: {
					type: { $literal: "fooditems" },
					id: "$_id",
					name: 1,
					image: "$img",
					price: 1,
					vendor: {
						id: "$vendorInfo._id",
						name: "$vendorInfo.name",
					},
					_id: 0,
				},
			},
			{ $limit: limit },
		]).allowDiskUse(true);

		return foods;
	} catch (err) {
		logger.error(`Food item search error: ${err.message}`);
		return [];
	}
};

const searchCombos = async (query, limit, includeUnavailable) => {
	try {
		const matchStage = { $text: { $search: query } };
		if (!includeUnavailable) matchStage.isAvailable = true;

		const combos = await Combo.aggregate([
			{ $match: matchStage },
			{
				$project: {
					type: { $literal: "combo" },
					id: "$_id",
					name: "$comboName",
					image: "$img",
					basePrice: 1,
					description: 1,
					_id: 0,
				},
			},
			{ $limit: limit },
		]).allowDiskUse(true);

		return combos;
	} catch (err) {
		logger.error(`Combo search error: ${err.message}`);
		return [];
	}
};

const searchPlates = async (query, limit) => {
	try {
		const plates = await Plate.aggregate([
			{ $match: { $text: { $search: query } } },
			{
				$project: {
					type: { $literal: "plate" },
					id: "$_id",
					name: 1,
					image: "$img",
					price: 1,
					description: 1,
					_id: 0,
				},
			},
			{ $limit: limit },
		]).allowDiskUse(true);

		return plates;
	} catch (err) {
		logger.error(`Plate search error: ${err.message}`);
		return [];
	}
};

const universalSearch = async (query, options = {}) => {
	const perfTimer = measurePerformance("Universal Search");

	try {
		const {
			limit = 25,
			page = 1,
			type = null,
			includeUnavailable = false,
		} = options;

		const maxLimit = Math.min(limit, 30);
		const skip = (page - 1) * maxLimit;
		const searchQuery = query.trim();
		if (!searchQuery) throw new Error("Search query is required");

		const vendors =
			!type || type === "vendor"
				? await searchVendors(searchQuery, maxLimit, includeUnavailable)
				: [];
		const fooditems =
			!type || type === "fooditems"
				? await searchFoodItems(searchQuery, maxLimit, includeUnavailable)
				: [];
		const combos =
			!type || type === "combo"
				? await searchCombos(searchQuery, maxLimit, includeUnavailable)
				: [];
		const plates =
			!type || type === "plate"
				? await searchPlates(searchQuery, maxLimit)
				: [];

		const duration = perfTimer();

		return {
			success: true,
			query: searchQuery,
			page,
			limit: maxLimit,
			responseTime: `${duration.toFixed(2)}ms`,
			results: {
				vendors,
				fooditems,
				combos,
				plates,
			},
		};
	} catch (err) {
		logger.error(`Universal search error: ${err.message}`);
		throw err;
	}
};

const getSearchSuggestions = async (query, limit = 10) => {
	if (!query || query.length < 2) return [];

	const regex = new RegExp(`^${query}`, "i");

	const [vendors, combos, plates, items] = await Promise.all([
		VendorProfile.find({ name: regex, isActive: true }, { name: 1 }).limit(
			limit,
		),
		Combo.find({ comboName: regex, isAvailable: true }, { comboName: 1 }).limit(
			limit,
		),
		Plate.find({ name: regex }, { name: 1 }).limit(limit),
		FoodItem.find({ name: regex, isAvailable: true }, { name: 1 }).limit(limit),
	]);

	return [
		...vendors.map((v) => ({ text: v.name, type: "vendor" })),
		...combos.map((c) => ({ text: c.comboName, type: "combo" })),
		...plates.map((p) => ({ text: p.name, type: "plate" })),
		...items.map((i) => ({ text: i.name, type: "fooditems" })),
	].slice(0, limit);
};

module.exports = {
	universalSearch,
	searchVendors,
	searchFoodItems,
	searchCombos,
	searchPlates,
	getSearchSuggestions,
};
