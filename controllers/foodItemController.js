const { VendorProfile, FoodItem, Combo } = require("../models");
const {
	getCategoryValues,
	getSubCategoryValues,
} = require("../utils/foodEnums");
const { paginate } = require("../utils/paginate");

// GET /api/food-items/by-category?category=rice&page=1&limit=20
// Returns flat list of individual food items for a category, with vendor info.
const getFoodByCategory = async (req, res) => {
	try {
		const { category, page = 1, limit = 20 } = req.query;
		if (!category)
			return res.status(400).json({ success: false, message: "category is required" });

		const pageNum = parseInt(page);
		const limitNum = parseInt(limit);
		const skip = (pageNum - 1) * limitNum;

		const pipeline = [
			{ $match: { category: category.toLowerCase(), isAvailable: true } },
			{ $unwind: "$subCategory" },
			{ $unwind: "$subCategory.items" },
			{ $match: { "subCategory.items.isAvailable": { $ne: false } } },
			{
				$lookup: {
					from: "vendorprofiles",
					localField: "vendor",
					foreignField: "_id",
					as: "vendorInfo",
				},
			},
			{ $unwind: "$vendorInfo" },
			{ $match: { "vendorInfo.isActive": true } },
			{
				$project: {
					_id: 0,
					foodItemId: "$_id",
					itemId: "$subCategory.items._id",
					name: "$subCategory.items.name",
					price: "$subCategory.items.price",
					img: "$subCategory.items.img",
					description: "$subCategory.items.description",
					category: 1,
					vendor: {
						_id: "$vendorInfo._id",
						name: "$vendorInfo.name",
						img: {
							$ifNull: [
								"$vendorInfo.logoUrl",
								"$vendorInfo.profileImage",
								"$vendorInfo.bannerUrl",
								null,
							],
						},
						location: "$vendorInfo.location",
						isOnline: {
							$eq: [
								{ $arrayElemAt: ["$vendorInfo.storeDetails.status", 0] },
								"active",
							],
						},
					},
				},
			},
			{ $skip: skip },
			{ $limit: limitNum },
		];

		const data = await FoodItem.aggregate(pipeline).allowDiskUse(true);

		res.json({
			success: true,
			data,
			pagination: {
				page: pageNum,
				limit: limitNum,
				hasNextPage: data.length === limitNum,
			},
		});
	} catch (err) {
		res.status(500).json({ success: false, message: err.message });
	}
};

const createFoodItem = async (req, res) => {
	try {
		let { category, isCompulsory, subCategories } = req.body;

		const vendorId = req.user.id;
		const vendor = await VendorProfile.findOne({ owner: vendorId }).lean();

		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor profile not found." });

		if (!category)
			return res
				.status(400)
				.json({ success: false, message: "Category is required." });

		category = category.toLowerCase();

		if (!getCategoryValues().includes(category))
			return res.status(400).json({
				success: false,
				message: `Invalid category. Must be one of: ${getCategoryValues().join(", ")}`,
			});

		if (typeof subCategories === "string") {
			try {
				subCategories = JSON.parse(subCategories);
			} catch {
				return res.status(400).json({
					success: false,
					message: "Invalid subCategories format.",
				});
			}
		}

		if (
			!subCategories ||
			!Array.isArray(subCategories) ||
			subCategories.length === 0
		)
			return res.status(400).json({
				success: false,
				message: "At least one subcategory is required.",
			});

		const totalItems = subCategories.reduce((acc, subCat) => {
			return acc + (subCat.items?.length || 0);
		}, 0);

		if (totalItems > 20)
			return res.status(400).json({
				success: false,
				message: "You can only create a maximum of 20 items in one request.",
			});

		const serviceType = Array.isArray(vendor.servicesOffered)
			? vendor.servicesOffered
			: [vendor.servicesOffered];

		const images = req.files?.img || [];
		let imageIndex = 0;
		const builtSubCategories = [];

		for (const subCat of subCategories) {
			if (!subCat.name)
				return res.status(400).json({
					success: false,
					message: "Each subcategory must have a name.",
				});

			const normalizedSubCatName = subCat.name.toLowerCase();

			if (!getSubCategoryValues().includes(normalizedSubCatName))
				return res.status(400).json({
					success: false,
					message: `Invalid subCategory "${subCat.name}". Must be one of: ${getSubCategoryValues().join(", ")}`,
				});

			if (
				!subCat.items ||
				!Array.isArray(subCat.items) ||
				subCat.items.length === 0
			)
				return res.status(400).json({
					success: false,
					message: `Subcategory "${subCat.name}" must have at least one item.`,
				});

			const builtItems = [];

			for (const item of subCat.items) {
				if (!item.name || !item.price)
					return res.status(400).json({
						success: false,
						message: "Each item must have a name and price.",
					});

				if (item.price <= 0)
					return res.status(400).json({
						success: false,
						message: "Price must be greater than 0.",
					});

				if (serviceType.includes("preOrderMeals") && !item.preparationTime)
					return res.status(400).json({
						success: false,
						message: `preparationTime is required for pre-order meals. Item "${item.name}" is missing it.`,
					});

				if (!images[imageIndex])
					return res.status(400).json({
						success: false,
						message: `Image is required for item "${item.name}".`,
					});

				builtItems.push({
					name: item.name,
					price: item.price,
					description: item.description || null,
					preparationTime: item.preparationTime || null,
					minQuantity: item.minQuantity || 1,
					maxQuantity: item.maxQuantity || null,
					img: images[imageIndex].path,
				});

				imageIndex++;
			}

			builtSubCategories.push({
				name: normalizedSubCatName,
				items: builtItems,
			});
		}

		const foodItem = await FoodItem.create({
			category,
			vendor: vendor._id,
			isCompulsory: isCompulsory === true || isCompulsory === "true",
			subCategory: builtSubCategories,
		});

		res.status(201).json({
			success: true,
			message: "Food item created successfully",
			data: foodItem,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};
const addSubCategories = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		let {
			subCategoryName,
			itemName,
			price,
			description,
			preparationTime,
			minQuantity,
			maxQuantity,
			isCompulsory,
		} = req.body;

		const vendorId = req.user.id;

		const vendor = await VendorProfile.findOne({ owner: vendorId });
		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor profile not found." });

		const foodItem = await FoodItem.findOne({
			_id: foodItemId,
			vendor: vendor._id,
		});
		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found." });

		if (!subCategoryName)
			return res
				.status(400)
				.json({ success: false, message: "subCategoryName is required." });

		// Normalize subcategory name to lowercase
		subCategoryName = subCategoryName.toLowerCase();

		if (!getSubCategoryValues().includes(subCategoryName))
			return res.status(400).json({
				success: false,
				message: `Invalid subCategory. Must be one of: ${getSubCategoryValues().join(", ")}`,
			});

		if (!itemName || !price)
			return res.status(400).json({
				success: false,
				message: "itemName and price are required.",
			});

		if (price <= 0)
			return res
				.status(400)
				.json({ success: false, message: "Price must be greater than 0." });

		// Normalize servicesOffered to handle both array and string
		const serviceType = Array.isArray(vendor.servicesOffered)
			? vendor.servicesOffered
			: [vendor.servicesOffered];

		if (serviceType.includes("preOrderMeals") && !preparationTime)
			return res.status(400).json({
				success: false,
				message: "preparationTime is required for pre-order meals.",
			});

		if (!req.files || !req.files.img || !req.files.img[0])
			return res
				.status(400)
				.json({ success: false, message: "Image is required." });

		// Business limit check
		const vendorFoodItems = await FoodItem.find({ vendor: vendor._id });
		const existingItemsCount = vendorFoodItems.reduce((acc, fi) => {
			return (
				acc +
				fi.subCategory.reduce((subAcc, subCat) => {
					return subAcc + subCat.items.length;
				}, 0)
			);
		}, 0);

		if (existingItemsCount >= 100)
			return res.status(400).json({
				success: false,
				message:
					"You have reached the maximum limit of 100 items. Please delete some items before adding more.",
			});

		const newItem = {
			name: itemName,
			price,
			description: description || null,
			preparationTime: preparationTime || null,
			minQuantity: minQuantity || 1,
			maxQuantity: maxQuantity || null,
			img: req.files.img[0].path,
		};

		// Check if subcategory group already exists
		const existingSubCategory = foodItem.subCategory.find(
			(sub) => sub.name === subCategoryName,
		);

		if (existingSubCategory) {
			existingSubCategory.items.push(newItem);
		} else {
			foodItem.subCategory.push({
				name: subCategoryName,
				items: [newItem],
			});
		}

		if (isCompulsory !== undefined) {
			foodItem.isCompulsory = isCompulsory === true || isCompulsory === "true";
		}

		await foodItem.save();

		res.status(200).json({
			success: true,
			message: existingSubCategory
				? `Item added under existing "${subCategoryName}" subcategory`
				: `New "${subCategoryName}" subcategory created with item`,
			data: foodItem,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};
const deleteSubCategory = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const { subCategoryName, itemId } = req.body;
		const vendorId = req.user.id;

		const vendor = await VendorProfile.findOne({ owner: vendorId });
		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor profile not found." });

		const foodItem = await FoodItem.findOne({
			_id: foodItemId,
			vendor: vendor._id,
		});
		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found." });

		if (!subCategoryName)
			return res
				.status(400)
				.json({ success: false, message: "subCategoryName is required." });

		const subCategoryIndex = foodItem.subCategory.findIndex(
			(sub) => sub.name === subCategoryName,
		);

		if (subCategoryIndex === -1)
			return res.status(404).json({
				success: false,
				message: `Subcategory "${subCategoryName}" not found on this food item.`,
			});

		if (itemId) {
			// Remove a specific item from the subcategory
			const subCategory = foodItem.subCategory[subCategoryIndex];
			const itemIndex = subCategory.items.findIndex(
				(item) => item._id.toString() === itemId,
			);

			if (itemIndex === -1)
				return res.status(404).json({
					success: false,
					message: "Item not found in this subcategory.",
				});

			subCategory.items.splice(itemIndex, 1);

			// If no items left in subcategory, remove the subcategory group too
			if (subCategory.items.length === 0) {
				foodItem.subCategory.splice(subCategoryIndex, 1);
			}
		} else {
			// Remove the entire subcategory group and all its items
			foodItem.subCategory.splice(subCategoryIndex, 1);
		}

		// If no subcategories left, isCompulsory must be false
		if (foodItem.subCategory.length === 0) {
			foodItem.isCompulsory = false;
		}

		await foodItem.save();

		res.status(200).json({
			success: true,
			message: itemId
				? "Item removed from subcategory successfully"
				: `Subcategory "${subCategoryName}" and all its items removed successfully`,
			data: foodItem,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};
// UPDATE FOOD ITEM
const updateFoodItem = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const foodItem = await FoodItem.findById(foodItemId).populate("vendor");

		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found." });

		if (!foodItem.vendor.owner.equals(req.user.id))
			return res.status(403).json({
				success: false,
				message: "Not authorized to update this food item.",
			});

		const allowedFields = [
			"name",
			"price",
			"description",
			"category",
			"subCategory",
			"preparationTime",
			"minQuantity",
			"maxQuantity",
			"isCompulsory",
		];

		allowedFields.forEach((field) => {
			if (req.body[field] !== undefined) {
				foodItem[field] =
					field === "isCompulsory"
						? req.body[field] === true || req.body[field] === "true"
						: req.body[field];
			}
		});

		// Validate category & subcategory
		if (foodItem.category && !getCategoryValues().includes(foodItem.category))
			return res
				.status(400)
				.json({ success: false, message: "Invalid category" });

		if (
			foodItem.subCategory &&
			!getSubCategoryValues().includes(foodItem.subCategory)
		)
			return res
				.status(400)
				.json({ success: false, message: "Invalid subcategory" });

		if (foodItem.isCompulsory && !foodItem.subCategory)
			return res.status(400).json({
				success: false,
				message: "Subcategory required for compulsory items",
			});

		// Update images if provided
		if (req.files) {
			if (req.files.img && req.files.img[0])
				foodItem.img = req.files.img[0].path;
			if (req.files.sideImage && req.files.sideImage[0])
				foodItem.sideImage = req.files.sideImage[0].path;
		}

		await foodItem.save();

		res.status(200).json({
			success: true,
			message: "Food item updated successfully",
			data: foodItem,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

const deleteFoodItem = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const foodItem = await FoodItem.findById(foodItemId).populate("vendor");
		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found" });
		// Check if current user owns the vendor profile
		if (!foodItem.vendor.owner.equals(req.user.id))
			return res.status(403).json({
				success: false,
				message: "Not authorized to delete this food item",
			});

		await foodItem.deleteOne();
		res.json({ success: true, message: "Food item deleted successfully" });
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

const getAllFoodItems = async (req, res) => {
	try {
		const filter = { isAvailable: true };
		if (req.query.category) filter.category = req.query.category;

		// Define what we want to "join" from the Vendor model
		const populate = {
			path: "vendor",
			select: "storeDetails name img profileImage bannerUrl logoUrl description averageRating totalOrders",
		};

		const result = await paginate(FoodItem, req.query, populate, filter);

		res.status(200).json(result);
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

const getFoodItemById = async (req, res) => {
	try {
		const foodItem = await FoodItem.findById(req.params.foodItemId).populate(
			"vendor",
			"storeDetails img description averageRating totalOrders location",
		);
		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found" });
		res.status(200).json({ success: true, data: foodItem });
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

const getMyFoodItems = async (req, res) => {
	try {
		// Find the vendor profile for this user
		const vendor = await VendorProfile.findOne({ owner: req.user.id });
		if (!vendor) {
			return res
				.status(404)
				.json({ success: false, message: "Vendor profile not found" });
		}
		// Create a filter using VendorProfile ID
		const filter = { vendor: vendor._id };

		const result = await paginate(FoodItem, req.query, null, filter);

		res.status(200).json(result);
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

// Helper to process selections
const processSelections = async (selections, vendorId) => {
	if (!selections) return [];
	let parsedSelections = selections;
	if (typeof selections === "string") {
		try {
			parsedSelections = JSON.parse(selections);
		} catch {
			throw new Error("Invalid selections format");
		}
	}
	if (!Array.isArray(parsedSelections)) return [];

	const itemIds = [];
	parsedSelections.forEach((group) => {
		if (group.items && Array.isArray(group.items)) {
			group.items.forEach((selectionItem) => {
				if (selectionItem.item) itemIds.push(selectionItem.item.toString());
			});
		}
	});

	if (itemIds.length === 0) return parsedSelections;

	// Query parent FoodItem docs that contain any of these nested item _ids
	const foodItemDocs = await FoodItem.find({
		vendor: vendorId,
		"subCategory.items._id": { $in: itemIds },
	});

	// Build a flat map of itemId -> nested item data
	const itemMap = new Map();
	foodItemDocs.forEach((doc) => {
		doc.subCategory.forEach((sub) => {
			sub.items.forEach((item) => {
				itemMap.set(item._id.toString(), item);
			});
		});
	});

	console.log("itemMap keys:", [...itemMap.keys()]);

	return parsedSelections.map((group) => {
		const populatedItems = [];
		if (group.items && Array.isArray(group.items)) {
			group.items.forEach((selectionItem) => {
				const key = selectionItem.item.toString();
				const foundItem = itemMap.get(key);
				if (foundItem) {
					populatedItems.push({
						item: foundItem._id,
						name: foundItem.name,
						price: foundItem.price,
						isAvailable: foundItem.isAvailable,
					});
				} else {
					console.warn("Item not found for id:", key);
				}
			});
		}
		return { ...group, items: populatedItems };
	});
};

const createCombo = async (req, res) => {
	try {
		const {
			comboName,
			description,
			basePrice,
			selections,
			time,
			deliveryTime,
			comboGroup,
		} = req.body;
		const vendorId = req.user.id;
		const vendor = await VendorProfile.findOne({ owner: vendorId });
		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor profile not found." });
		if (!comboName || !basePrice || !req.file || !time)
			return res.status(400).json({
				success: false,
				message: "comboName, basePrice, img, and time are required",
			});
		if (basePrice <= 0)
			return res
				.status(400)
				.json({ success: false, message: "Base price must be greater than 0" });

		const processedSelections = await processSelections(
			selections,
			vendor._id, // Pass VendorProfile ID
		);

		const combo = await Combo.create({
			comboName,
			description,
			basePrice,
			selections: processedSelections,
			vendor: vendor._id, // Use VendorProfile ID, not User ID
			img: req.file.path,
			time,
			deliveryTime,
			comboGroup, // Optional field
		});
		res.status(201).json({
			success: true,
			message: "Combo created successfully",
			data: combo,
		});
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

const updateCombo = async (req, res) => {
	try {
		const combo = await Combo.findById(req.params.comboId).populate("vendor");
		if (!combo)
			return res
				.status(404)
				.json({ success: false, message: "Combo not found" });
		// Check if current user owns the vendor profile
		if (!combo.vendor.owner.equals(req.user.id))
			return res.status(403).json({
				success: false,
				message: "Not authorized to update this combo",
			});
		if (req.body.basePrice !== undefined && req.body.basePrice <= 0)
			return res
				.status(400)
				.json({ success: false, message: "Base price must be greater than 0" });

		const { vendor, selections, ...updateData } = req.body;

		if (selections) {
			updateData.selections = await processSelections(
				selections,
				combo.vendor._id, // Use VendorProfile ID from populated combo
			);
		}

		// Ensure comboGroup is updated if provided
		if (req.body.comboGroup !== undefined) {
			updateData.comboGroup = req.body.comboGroup;
		}

		Object.assign(combo, updateData);
		if (req.file) combo.img = req.file.path;
		await combo.save();
		res.status(200).json({
			success: true,
			message: "Combo updated successfully",
			data: combo,
		});
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

const deleteCombo = async (req, res) => {
	try {
		const combo = await Combo.findById(req.params.comboId).populate("vendor");
		if (!combo)
			return res
				.status(404)
				.json({ success: false, message: "Combo not found" });
		// Check if current user owns the vendor profile
		if (!combo.vendor.owner.equals(req.user.id))
			return res.status(403).json({
				success: false,
				message: "Not authorized to delete this combo",
			});
		await combo.deleteOne();
		res
			.status(200)
			.json({ success: true, message: "Combo deleted successfully" });
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

const getAllCombos = async (req, res) => {
	try {
		const populateOptions = [
			{ path: "vendor", select: "img description averageRating totalOrders" },
			{
				path: "selections.items.item",
				select: "name img description price",
			},
			{ path: "comboGroup", select: "name description" }, // Populate comboGroup
		];

		const result = await paginate(Combo, req.query, populateOptions);
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

const getMyCombos = async (req, res) => {
	try {
		// Find the vendor profile for this user
		const vendor = await VendorProfile.findOne({ owner: req.user.id });
		if (!vendor) {
			return res
				.status(404)
				.json({ success: false, message: "Vendor profile not found" });
		}
		// Create a filter using VendorProfile ID
		const filter = { vendor: vendor._id };
		const populateOptions = [
			{
				path: "selections.items.item",
				select: "name img description price",
			},
			{ path: "comboGroup", select: "name description" },
		];

		const result = await paginate(Combo, req.query, populateOptions, filter);
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

const getComboById = async (req, res) => {
	try {
		const combo = await Combo.findById(req.params.comboId)
			.populate("vendor", " img description averageRating totalOrders location")
			.populate({
				path: "selections.items.item",
				select: "name img description price",
			})
			.populate("comboGroup", "name description");
		if (!combo)
			return res
				.status(404)
				.json({ success: false, message: "Combo not found" });
		res.status(200).json({ success: true, data: combo });
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};
const getVendorCombos = async (req, res) => {
	try {
		const filter = { vendor: req.params.vendorId };
		const populateOptions = [
			{ path: "vendor", select: "img description averageRating totalOrders" },
			{
				path: "selections.items.item",
				select: "name img description price",
			},
			{ path: "comboGroup", select: "name description" },
		];

		const result = await paginate(Combo, req.query, populateOptions, filter);
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

const getVendorCombosGrouped = async (req, res) => {
	try {
		const { vendorId } = req.params;

		// Fetch all combos for the vendor
		const combos = await Combo.find({ vendor: vendorId })
			.populate("comboGroup", "name description")
			.populate({
				path: "selections.items.item",
				select: "name img description price",
			});

		// Group by ComboGroup name
		const grouped = {};
		const uncategorized = [];

		combos.forEach((combo) => {
			if (combo.comboGroup) {
				const groupName = combo.comboGroup.name;
				const groupId = combo.comboGroup.id; // toJSON plugin uses id

				if (!grouped[groupId]) {
					grouped[groupId] = {
						groupInfo: combo.comboGroup,
						items: [],
					};
				}
				grouped[groupId].items.push(combo);
			} else {
				uncategorized.push(combo);
			}
		});

		// Convert object to array for easier frontend consumption
		const groupsArray = Object.values(grouped).sort((a, b) =>
			a.groupInfo.name.localeCompare(b.groupInfo.name),
		);

		if (uncategorized.length > 0) {
			groupsArray.push({
				groupInfo: { id: "uncategorized", name: "Uncategorized" },
				items: uncategorized,
			});
		}

		res.status(200).json({ success: true, data: groupsArray });
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};
const toggleFoodItemAvailability = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const vendorId = req.user.id;

		const vendor = await VendorProfile.findOne({ owner: vendorId }).lean();
		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor not found" });

		const item = await FoodItem.findOne({
			_id: foodItemId,
			vendor: vendor._id,
		});
		if (!item)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found" });

		item.isAvailable = !item.isAvailable;
		await item.save();

		return res.json({
			success: true,
			isAvailable: item.isAvailable,
			message: `Item is now ${item.isAvailable ? "available" : "unavailable"}`,
		});
	} catch (error) {
		return res.status(500).json({ success: false, message: error.message });
	}
};

module.exports = {
	createFoodItem,
	updateFoodItem,
	addSubCategories,
	deleteSubCategory,
	deleteFoodItem,
	getAllFoodItems,
	getFoodItemById,
	getMyFoodItems,
	getFoodByCategory,
	createCombo,
	updateCombo,
	deleteCombo,
	getAllCombos,
	getComboById,
	getMyCombos,
	getVendorCombos,
	getVendorCombosGrouped,
	toggleFoodItemAvailability,
};
