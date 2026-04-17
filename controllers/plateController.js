const { Plate, FoodItem, Combo, Customer } = require("../models");
const { deleteImage } = require("../config/cloudinary");
const { paginate } = require("../utils/paginate");

const buildPlate = async (req, res) => {
	try {
		let { name, items, vendor } = req.body;

		if (typeof items === "string") {
			try {
				items = JSON.parse(items);
			} catch (e) {
				// Check if it's a comma-separated list
				if (items.includes(",")) {
					items = items.split(",").map((item) => item.trim());
				} else {
					// if it's just a single ID string, wrap it in an array
					items = [items];
				}
			}
		}

		// Lookup Customer ID from User ID
		const customer = await Customer.findOne({ user: req.user.id });
		if (!customer) {
			return res.status(404).json({ error: "Customer profile not found" });
		}

		// Fetch item details to calculate price and description
		const selectedItems = await FoodItem.find({ _id: { $in: items } });
		const selectedCombos = await Combo.find({ _id: { $in: items } });

		// Debugging: See if items are actually being found in your terminal
		console.log(
			"Items found in DB:",
			selectedItems.length,
			"Combos found:",
			selectedCombos.length,
		);

		if (selectedItems.length + selectedCombos.length === 0) {
			return res
				.status(400)
				.json({ error: "No valid food items or combos selected" });
		}

		// Calculate total price
		const price = [...selectedItems, ...selectedCombos].reduce(
			(sum, item) => sum + (item.price || item.basePrice || 0),
			0,
		);

		// Calculate max preparation time (assuming parallel preparation, or sum if sequential - usually max for plates)
		// Parse "30 mins" or "30" to numbers
		const times = [...selectedItems, ...selectedCombos].map(
			(item) => parseInt(item.preparationTime || item.time) || 0,
		);
		const maxTime = Math.max(...times);
		const timeToMake = `${maxTime} mins`;

		const description = [
			...selectedItems.map((item) => item.name),
			...selectedCombos.map((combo) => combo.comboName),
		].join(", ");

		const foodItemIds = selectedItems.map((item) => item._id);
		const comboIds = selectedCombos.map((item) => item._id);

		// Logic to build a plate using plateData
		const newPlate = await Plate.create({
			name,
			customer: customer._id, // Use Customer document ID, not User ID
			vendor,
			price,
			img: req.file ? req.file.path : undefined,
			timeToMake,
			items: foodItemIds,
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

		// Trending sort requires an aggregation pipeline to compute a composite score
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
									"$vendorInfo.profileImage",
									"$vendorInfo.bannerUrl",
									null,
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

		// For all other sort fields (likes, ordersCount, commentsCount, createdAt),
		// the paginate utility handles it via sortBy/sortOrder query params
		const populateOptions = [
			{ path: "items", select: "name price img -vendor" },
			{ path: "combos", select: "comboName basePrice img -vendor" },
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

/**
 * GET /api/plates/popular
 * Returns top plates ranked by popularity score: likes + (ordersCount × 2)
 */
const getPopularPlates = async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit) || 10, 20);

		const plates = await Plate.aggregate([
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
								"$vendorInfo.profileImage",
								"$vendorInfo.bannerUrl",
								null,
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

/**
 * GET /api/plates/popular
 * Returns top plates ranked by popularity score: likes + (ordersCount × 2)
 */
const getPopularPlates = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 20);

        const plates = await Plate.aggregate([
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
                    name: 1, description: 1, price: 1, img: 1,
                    likes: 1, ordersCount: 1, commentsCount: 1, popularityScore: 1,
                    timeToMake: 1, rating: 1, averageRating: 1, createdAt: 1,
                    vendor: {
                        _id: "$vendorInfo._id",
                        name: "$vendorInfo.name",
                        isOnline: { $eq: [{ $arrayElemAt: ["$vendorInfo.storeDetails.status", 0] }, "active"] },
                        image: { $ifNull: ["$vendorInfo.logoUrl", "$vendorInfo.profileImage", "$vendorInfo.bannerUrl", null] },
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
			.populate("items", "-vendor -averageRating -ratingCount -likes")
			.populate("combos", "-vendor -averageRating -ratingCount -likes")
			.populate("vendor", "storeDetails img description")
			.populate("customer", "firstName lastName img");
		if (!plate) {
			return res.status(404).json({ error: "Plate not found" });
		}
		res.status(200).json(plate);
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
		console.log(plate.customer.user.toString());
		// Compare User IDs since req.user.id is User ID
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
		// 1. Find all plates that don't have a description yet
		const plates = await Plate.find();

		for (let plate of plates) {
			// 2. Look up the food items for this specific plate
			const selectedItems = await FoodItem.find({ _id: { $in: plate.items } });
			const selectedCombos = await Combo.find({ _id: { $in: plate.combos } });

			// 3. Create the description string
			const description = [
				...selectedItems.map((item) => item.name),
				...selectedCombos.map((combo) => combo.comboName),
			].join(", ");

			// 4. Update the plate in the DB
			plate.description = description;
			await plate.save();
		}

		res.status(200).json({
			message: "All existing plates have been updated with descriptions!",
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
