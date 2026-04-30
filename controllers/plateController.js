const { Plate, FoodItem, Combo, Customer, VendorProfile } = require("../models");
const { deleteImage } = require("../config/cloudinary");
const { paginate } = require("../utils/paginate");
const logger = require("../utils/logger");
/**
 * Helper: given an array of SubCategoryItem IDs (strings or ObjectIds),
 * queries parent FoodItems and extracts the matching embedded subdocs.
 */
const resolveSubCategoryItems = async (itemIds) => {
	if (!itemIds || itemIds.length === 0) return [];

	const idStrings = itemIds.map(String);

	const parentFoodItems = await FoodItem.find({
		"subCategory.items._id": { $in: itemIds },
	});

	const resolved = [];
	for (const foodItem of parentFoodItems) {
		for (const sub of foodItem.subCategory) {
			for (const subItem of sub.items) {
				if (idStrings.includes(subItem._id.toString())) {
					resolved.push(subItem);
				}
			}
		}
	}

	return resolved;
};

const buildPlate = async (req, res) => {
	try {
		let { name, items, vendor, totalPrice } = req.body;

		// Normalize items to an array of IDs
		if (typeof items === "string") {
			try {
				items = JSON.parse(items);
			} catch (e) {
				if (items.includes(",")) {
					items = items.split(",").map((item) => item.trim());
				} else {
					items = [items];
				}
			}
		}

		// Lookup Customer from User ID
		const customer = await Customer.findOne({ user: req.user.id });
		if (!customer) {
			return res.status(404).json({ error: "Customer profile not found" });
		}

		// Resolve nested SubCategoryItems from parent FoodItems
		const selectedItems = await resolveSubCategoryItems(items);

		// Resolve any Combos from the same items array
		const selectedCombos = await Combo.find({ _id: { $in: items } });

		logger.info(
			`SubCategoryItems resolved: ${selectedItems.length}, Combos found: ${selectedCombos.length}`,
		);

		// Allow plate creation when an explicit price snapshot is provided (e.g. order total),
		// even if the individual item IDs cannot be resolved from SubCategoryItems.
		const overridePrice = totalPrice !== undefined ? parseFloat(totalPrice) : null;
		if (selectedItems.length + selectedCombos.length === 0 && overridePrice === null) {
			return res
				.status(400)
				.json({ error: "No valid food items or combos selected" });
		}

		// Use the override price when provided; otherwise sum resolved item prices.
		const price =
			overridePrice !== null && overridePrice > 0
				? overridePrice
				: [
						...selectedItems.map((i) => i.price || 0),
						...selectedCombos.map((c) => c.basePrice || c.price || 0),
					].reduce((sum, p) => sum + p, 0);

		// Max prep time across all selected items/combos
		const times = [
			...selectedItems.map((i) => parseInt(i.preparationTime) || 0),
			...selectedCombos.map((c) => parseInt(c.time || c.preparationTime) || 0),
		];
		const maxTime = times.length > 0 ? Math.max(...times) : 0;
		const timeToMake = maxTime > 0 ? `${maxTime} mins` : "—";

		// Human-readable description from item/combo names
		const description = [
			...selectedItems.map((i) => i.name),
			...selectedCombos.map((c) => c.comboName),
		].join(", ");

		// Store the raw SubCategoryItem IDs (as passed in) and combo IDs separately
		const comboIds = selectedCombos.map((c) => c._id);

		// Image: route uses plateUpload.fields([{name:'file'}]) so the file is in req.files, not req.file
		const uploadedFile = req.files?.file?.[0] ?? req.file;

		const newPlate = await Plate.create({
			name,
			customer: customer._id,
			vendor,
			price,
			img: uploadedFile ? uploadedFile.path : undefined,
			timeToMake,
			items,
			combos: comboIds,
			description,
		});

		res.status(201).json(newPlate);
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

const getAllPlates = async (req, res) => {
	try {
		const { sortBy } = req.query;

		if (sortBy === "trending") {
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 10, 30);
			const skip = (page - 1) * limit;

			const results = await Plate.aggregate([
				{
					$addFields: {
						trendingScore: {
							$add: [
								{ $ifNull: ["$likes", 0] },
								{ $multiply: [{ $ifNull: ["$ordersCount", 0] }, 2] },
								{ $ifNull: ["$commentsCount", 0] },
							],
						},
					},
				},
				{ $sort: { trendingScore: -1, createdAt: -1 } },
				{
					$lookup: {
						from: "vendorprofiles",
						localField: "vendor",
						foreignField: "_id",
						as: "vendorInfo",
					},
				},
				{ $unwind: { path: "$vendorInfo", preserveNullAndEmptyArrays: true } },
				{ $skip: skip },
				{ $limit: limit },
				{
					$project: {
						id: { $toString: "$_id" },
						name: 1,
						description: 1,
						price: 1,
						img: 1,
						likes: 1,
						ordersCount: 1,
						commentsCount: 1,
						trendingScore: 1,
						timeToMake: 1,
						rating: 1,
						averageRating: 1,
						createdAt: 1,
						vendor: {
							_id: "$vendorInfo._id",
							name: "$vendorInfo.name",
							isOnline: {
								$eq: [
									{ $arrayElemAt: ["$vendorInfo.storeDetails.status", 0] },
									"active",
								],
							},
							image: {
								$ifNull: [
									"$vendorInfo.logoUrl",
									{
										$ifNull: [
											"$vendorInfo.profileImage",
											"$vendorInfo.bannerUrl",
										],
									},
								],
							},
						},
					},
				},
			]);

			const total = await Plate.countDocuments();
			return res.status(200).json({
				success: true,
				data: results,
				pagination: {
					total,
					page,
					limit,
					hasNextPage: skip + results.length < total,
				},
			});
		}

		const populateOptions = [
			{ path: "combos", select: "comboName basePrice img" },
			{
				path: "vendor",
				select: "name logoUrl profileImage bannerUrl isActive",
			},
			{ path: "customer", select: "firstName lastName img" },
		];

		const result = await paginate(Plate, req.query, populateOptions, {});
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

const getPopularPlates = async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit) || 10, 20);
		const zone = req.query.zone;

		let vendorFilter = {};
		if (zone) {
			const nearbyVendors = await VendorProfile.find({
				zone: { $regex: zone, $options: "i" },
			}).select("_id").lean();
			if (nearbyVendors.length > 0) {
				vendorFilter = { vendor: { $in: nearbyVendors.map((v) => v._id) } };
			}
		}

		const plates = await Plate.aggregate([
			{ $match: vendorFilter },
			{
				$addFields: {
					popularityScore: {
						$add: [
							{ $ifNull: ["$likes", 0] },
							{ $multiply: [{ $ifNull: ["$ordersCount", 0] }, 2] },
						],
					},
				},
			},
			{ $sort: { popularityScore: -1, createdAt: -1 } },
			{ $limit: limit },
			{
				$lookup: {
					from: "vendorprofiles",
					localField: "vendor",
					foreignField: "_id",
					as: "vendorInfo",
				},
			},
			{ $unwind: { path: "$vendorInfo", preserveNullAndEmptyArrays: true } },
			{
				$project: {
					id: { $toString: "$_id" },
					name: 1,
					description: 1,
					price: 1,
					img: 1,
					likes: 1,
					ordersCount: 1,
					commentsCount: 1,
					popularityScore: 1,
					timeToMake: 1,
					rating: 1,
					averageRating: 1,
					createdAt: 1,
					vendor: {
						_id: "$vendorInfo._id",
						name: "$vendorInfo.name",
						isOnline: {
							$eq: [
								{ $arrayElemAt: ["$vendorInfo.storeDetails.status", 0] },
								"active",
							],
						},
						image: {
							$ifNull: [
								"$vendorInfo.logoUrl",
								{
									$ifNull: [
										"$vendorInfo.profileImage",
										"$vendorInfo.bannerUrl",
									],
								},
							],
						},
					},
				},
			},
		]);

		res.status(200).json({ success: true, data: plates });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

const getSpecificPlate = async (req, res) => {
	try {
		const { plateId } = req.params;

		const plate = await Plate.findById(plateId)
			.populate("combos", "comboName basePrice img")
			.populate(
				"vendor",
				"name logoUrl profileImage bannerUrl storeDetails description",
			)
			.populate("customer", "firstName lastName img");

		if (!plate) {
			return res.status(404).json({ error: "Plate not found" });
		}

		// Resolve SubCategoryItems manually since they're embedded subdocs
		const resolvedItems = await resolveSubCategoryItems(plate.items);

		// Fallback: if stored IDs are parent FoodItem IDs (older plates), populate them so
		// the client can reconstruct which food categories were in the plate
		let foodItems = [];
		if (resolvedItems.length === 0 && plate.items.length > 0) {
			foodItems = await FoodItem.find({ _id: { $in: plate.items } })
				.select("category subCategory");
		}

		res.status(200).json({
			...plate.toObject(),
			items: resolvedItems,
			foodItems,
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

const deletePlate = async (req, res) => {
	try {
		const { plateId } = req.params;
		const plate = await Plate.findById(plateId).populate("customer", "user");
		if (!plate) {
			return res.status(404).json({ error: "Plate not found" });
		}

		if (req.user.id !== plate.customer.user.toString()) {
			return res
				.status(403)
				.json({ error: "Forbidden: You can only delete your own plates" });
		}

		if (plate.img) {
			const publicId = plate.img.split("/").pop().split(".")[0];
			await deleteImage(`plates/${publicId}`);
		}

		await plate.deleteOne();
		res.status(200).json({ message: "Plate deleted successfully" });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

const fixAllPlates = async (req, res) => {
	try {
		const plates = await Plate.find();
		let updated = 0;

		for (let plate of plates) {
			const resolvedItems = await resolveSubCategoryItems(plate.items);
			const resolvedCombos = await Combo.find({ _id: { $in: plate.combos } });

			// Recalculate price
			const price = [
				...resolvedItems.map((i) => i.price || 0),
				...resolvedCombos.map((c) => c.basePrice || c.price || 0),
			].reduce((sum, p) => sum + p, 0);

			// Recalculate prep time
			const times = [
				...resolvedItems.map((i) => parseInt(i.preparationTime) || 0),
				...resolvedCombos.map(
					(c) => parseInt(c.time || c.preparationTime) || 0,
				),
			];
			const maxTime = times.length > 0 ? Math.max(...times) : 0;

			// Recalculate description
			const description = [
				...resolvedItems.map((i) => i.name),
				...resolvedCombos.map((c) => c.comboName),
			].join(", ");

			plate.price = price;
			plate.timeToMake = `${maxTime} mins`;
			plate.description = description;
			await plate.save();
			updated++;
		}

		res.status(200).json({
			message: `${updated} plates updated with correct price, timeToMake, and description.`,
		});
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

module.exports = {
	buildPlate,
	getAllPlates,
	getPopularPlates,
	getSpecificPlate,
	deletePlate,
	fixAllPlates,
};
