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

const getNearbyVendorIds = async (coords) => {
	if (!coords || !coords.lat || !coords.lng) return null;
	const nearbyVendors = await VendorProfile.aggregate([
		{
			$geoNear: {
				near: {
					type: "Point",
					coordinates: [parseFloat(coords.lng), parseFloat(coords.lat)],
				},
				distanceField: "distanceMeters",
				maxDistance: 10000, // 10km proximity geofence limit
				query: {
					isActive: true,
					"storeDetails.0.status": "active",
				},
				spherical: true,
			},
		},
		{ $project: { _id: 1 } },
	]);
	return nearbyVendors.map((v) => v._id);
};

const searchVendors = async (query, limit, includeUnavailable, coords) => {
	try {
		const foodVendors = await FoodItem.aggregate([
			{ $match: { $text: { $search: query }, isAvailable: true } },
			{ $group: { _id: "$vendor" } },
		]);
		const vendorIdsFromFood = foodVendors.map((v) => v._id);

		const matchStage = {
			$or: [{ _id: { $in: vendorIdsFromFood } }, { $text: { $search: query } }],
		};
		if (!includeUnavailable) {
			matchStage.isActive = true;
			matchStage.storeDetails = { $exists: true, $not: { $size: 0 } };
			matchStage["storeDetails.0.status"] = "active";
		}

		const nearbyVendorIds = await getNearbyVendorIds(coords);
		if (nearbyVendorIds) {
			matchStage._id = { $in: nearbyVendorIds };
		}

		const vendors = await VendorProfile.aggregate([
			{ $match: matchStage },
			{
				$project: {
					type: { $literal: "vendor" },
					id: "$_id",
					name: 1,
					image: { $ifNull: ["$logoUrl", "$profileImage", "$bannerUrl"] },
					isOpen: {
						$eq: [{ $arrayElemAt: ["$storeDetails.status", 0] }, "active"],
					},
					averageRating: { $ifNull: ["$averageRating", 0] },
					totalRating: { $ifNull: ["$ratingCount", 0] },
					deliveryFee: { $ifNull: ["$fulfillmentSettings.deliveryPrice", 0] },
					location: 1,
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

const searchFoodItems = async (query, limit, includeUnavailable, coords) => {
	try {
		const matchStage = { $text: { $search: query } };
		if (!includeUnavailable) matchStage.isAvailable = true;

		const nearbyVendorIds = await getNearbyVendorIds(coords);
		if (nearbyVendorIds) {
			matchStage.vendor = { $in: nearbyVendorIds };
		}

		const foods = await FoodItem.aggregate([
			{ $match: matchStage },
			// Unwind subcategories and their items to get individual items
			{ $unwind: "$subCategory" },
			{ $unwind: "$subCategory.items" },
			// If unavailable filter applies, also filter subcategory items
			...(includeUnavailable
				? []
				: [{ $match: { "subCategory.items.isAvailable": true } }]),
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
					id: "$subCategory.items._id",
					name: "$subCategory.items.name",
					image: "$subCategory.items.img",
					price: "$subCategory.items.price",
					description: "$subCategory.items.description",
					vendor: {
						id: "$vendorInfo._id",
						name: "$vendorInfo.name",
						image: {
							$ifNull: [
								"$vendorInfo.bannerUrl",
								"$vendorInfo.profileImage",
								"$vendorInfo.logoUrl",
								null,
							],
						},
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

const searchCombos = async (query, limit, includeUnavailable, coords) => {
	try {
		const matchStage = { $text: { $search: query } };
		if (!includeUnavailable) matchStage.isAvailable = true;

		const nearbyVendorIds = await getNearbyVendorIds(coords);
		if (nearbyVendorIds) {
			matchStage.vendor = { $in: nearbyVendorIds };
		}

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

const searchPlates = async (query, limit, coords) => {
	try {
		const matchStage = { $text: { $search: query } };

		const nearbyVendorIds = await getNearbyVendorIds(coords);
		if (nearbyVendorIds) {
			matchStage.vendor = { $in: nearbyVendorIds };
		}

		const plates = await Plate.aggregate([
			{ $match: matchStage },
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
			coords = null,
		} = options;

		const maxLimit = Math.min(limit, 30);
		const skip = (page - 1) * maxLimit;
		const searchQuery = query.trim();
		if (!searchQuery) throw new Error("Search query is required");

		const vendors =
			!type || type === "vendor"
				? await searchVendors(searchQuery, maxLimit, includeUnavailable, coords)
				: [];
		const fooditems =
			!type || type === "fooditems"
				? await searchFoodItems(searchQuery, maxLimit, includeUnavailable, coords)
				: [];
		const combos =
			!type || type === "combo"
				? await searchCombos(searchQuery, maxLimit, includeUnavailable, coords)
				: [];
		const plates =
			!type || type === "plate"
				? await searchPlates(searchQuery, maxLimit, coords)
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
	const regex = new RegExp(query, "i");

	const [vendors, combos, plates, items] = await Promise.all([
		VendorProfile.find({ name: regex, isActive: true }, { name: 1 }).limit(
			limit,
		),

		Combo.aggregate([
			{ $match: { comboName: regex, isAvailable: true } },
			{
				$group: {
					_id: { $toLower: "$comboName" },
					name: { $first: "$comboName" },
				},
			},
			{ $project: { name: 1, _id: 0 } },
			{ $limit: limit },
		]),

		Plate.aggregate([
			{ $match: { name: regex } },
			{ $group: { _id: { $toLower: "$name" }, name: { $first: "$name" } } },
			{ $project: { name: 1, _id: 0 } },
			{ $limit: limit },
		]),

		FoodItem.aggregate([
			{ $unwind: "$subCategory" },
			{ $unwind: "$subCategory.items" },
			{
				$match: {
					"subCategory.items.name": regex,
					"subCategory.items.isAvailable": true,
				},
			},
			{
				$group: {
					_id: { $toLower: "$subCategory.items.name" },
					name: { $first: "$subCategory.items.name" },
				},
			},
			{ $project: { name: 1, _id: 0 } },
			{ $limit: limit },
		]),
	]);

	return [
		...vendors.map((v) => ({ text: v.name, type: "vendor" })),
		...combos.map((c) => ({ text: c.name, type: "combo" })),
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
