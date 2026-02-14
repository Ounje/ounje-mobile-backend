const { VendorProfile, FoodItem, Combo } = require("../models");
const { FOOD_ENUMS } = require("../utils/foodEnums");
const { paginate } = require("../utils/paginate");

const createFoodItem = async (req, res) => {
	try {
		const { name, price, description, category, subCategory, preparationTime, minQuantity, maxQuantity } =
			req.body;
		const vendorId = req.user.id;
		const vendor = await VendorProfile.findOne({ owner: vendorId });
		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor profile not found." });
		if (!vendor.isActive)
			return res.status(403).json({
				success: false,
				message:
					"Please complete your vendor profile before creating food items.",
			});
		if (!name || !price || !category || !preparationTime)
			return res.status(400).json({
				success: false,
				message: "Name, price, category, and preparationTime are required.",
			});
		if (price <= 0)
			return res
				.status(400)
				.json({ success: false, message: "Price must be greater than 0" });

		const validCategories = Object.values(FOOD_ENUMS.CATEGORIES);
		if (!validCategories.includes(category))
			return res.status(400).json({
				success: false,
				message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
			});
		if (subCategory) {
			const validSubCategories = Object.values(FOOD_ENUMS.SUB_CATEGORIES);
			if (!validSubCategories.includes(subCategory))
				return res.status(400).json({
					success: false,
					message: `Invalid subCategory. Must be one of: ${validSubCategories.join(", ")}`,
				});
		}

		if (!req.file)
			return res
				.status(400)
				.json({ success: false, message: "Image is required" });

		const foodItem = new FoodItem({
			name,
			price,
			description,
			category,
			subCategory,
			preparationTime,
			vendor: vendor._id, // Use VendorProfile ID, not User ID
			img: req.file.path,
			minQuantity: minQuantity || 1,
			maxQuantity: maxQuantity || null,
		});

		await foodItem.save();
		res.status(201).json({
			success: true,
			message: "Food item created successfully",
			data: foodItem,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};

const updateFoodItem = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const foodItem = await FoodItem.findById(foodItemId).populate('vendor');
		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found" });
		// Check if current user owns the vendor profile
		if (!foodItem.vendor.owner.equals(req.user.id))
			return res.status(403).json({
				success: false,
				message: "Not authorized to update this food item",
			});

		const allowedFields = [
			"name",
			"price",
			"description",
			"category",
			"subCategory",
			"preparationTime",
			"isAvailable",
			"minQuantity",
			"maxQuantity",
		];
		if (req.body.category) {
			const validCategories = Object.values(FOOD_ENUMS.CATEGORIES);
			if (!validCategories.includes(req.body.category))
				return res
					.status(400)
					.json({ success: false, message: "Invalid category" });
		}
		if (req.body.subCategory) {
			const validSubCategories = Object.values(FOOD_ENUMS.SUB_CATEGORIES);
			if (!validSubCategories.includes(req.body.subCategory))
				return res
					.status(400)
					.json({ success: false, message: "Invalid subCategory" });
		}
		if (req.body.price !== undefined && req.body.price <= 0)
			return res
				.status(400)
				.json({ success: false, message: "Price must be greater than 0" });

		allowedFields.forEach((field) => {
			if (req.body[field] !== undefined) foodItem[field] = req.body[field];
		});
		if (req.file) foodItem.img = req.file.path;

		await foodItem.save();
		res.json({
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
		const foodItem = await FoodItem.findById(foodItemId).populate('vendor');
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

		// Define what we want to "join" from the Vendor model
		const populate = {
			path: "vendor",
			select: "storeDetails img description averageRating totalOrders"
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
			return res.status(404).json({ success: false, message: "Vendor profile not found" });
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

	// Extract all item IDs
	const itemIds = [];
	parsedSelections.forEach((group) => {
		if (group.items && Array.isArray(group.items)) {
			group.items.forEach((selectionItem) => {
				if (selectionItem.item) itemIds.push(selectionItem.item);
			});
		}
	});

	if (itemIds.length === 0) return parsedSelections;

	// Fetch all items
	const foodItems = await FoodItem.find({
		_id: { $in: itemIds },
		vendor: vendorId, // Ensure items belong to this vendor profile
	});

	const foodItemMap = new Map(foodItems.map((item) => [item.id, item]));

	// Reconstruct selections with populated data
	return parsedSelections.map((group) => {
		const populatedItems = [];
		if (group.items && Array.isArray(group.items)) {
			group.items.forEach((selectionItem) => {
				const foodItem = foodItemMap.get(selectionItem.item.toString());
				if (foodItem) {
					populatedItems.push({
						item: foodItem._id,
						name: foodItem.name,
						price: foodItem.price,
						isAvailable: foodItem.isAvailable,
					});
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
		if (!vendor.isActive)
			return res.status(403).json({
				success: false,
				message: "Please complete your vendor profile before creating combos.",
			});
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
		const combo = await Combo.findById(req.params.comboId).populate('vendor');
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
				select: "name img description price"
			},
			{ path: "comboGroup", select: "name description" } // Populate comboGroup
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
			return res.status(404).json({ success: false, message: "Vendor profile not found" });
		}
		// Create a filter using VendorProfile ID
		const filter = { vendor: vendor._id };
		const populateOptions = [
			{
				path: "selections.items.item",
				select: "name img description price"
			},
			{ path: "comboGroup", select: "name description" }
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
			.populate(
				"vendor",
				" img description averageRating totalOrders location",
			)
			.populate({
				path: "selections.items.item",
				select: "name img description price"
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
				select: "name img description price"
			},
			{ path: "comboGroup", select: "name description" }
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
				select: "name img description price"
			});

		// Group by ComboGroup name
		const grouped = {};
		const uncategorized = [];

		combos.forEach(combo => {
			if (combo.comboGroup) {
				const groupName = combo.comboGroup.name;
				const groupId = combo.comboGroup.id; // toJSON plugin uses id

				if (!grouped[groupId]) {
					grouped[groupId] = {
						groupInfo: combo.comboGroup,
						items: []
					};
				}
				grouped[groupId].items.push(combo);
			} else {
				uncategorized.push(combo);
			}
		});

		// Convert object to array for easier frontend consumption
		const groupsArray = Object.values(grouped).sort((a, b) =>
			a.groupInfo.name.localeCompare(b.groupInfo.name)
		);

		if (uncategorized.length > 0) {
			groupsArray.push({
				groupInfo: { id: "uncategorized", name: "Uncategorized" },
				items: uncategorized
			});
		}

		res.status(200).json({ success: true, data: groupsArray });
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};
module.exports = {
	createFoodItem,
	updateFoodItem,
	deleteFoodItem,
	getAllFoodItems,
	getFoodItemById,
	getMyFoodItems,
	createCombo,
	updateCombo,
	deleteCombo,
	getAllCombos,
	getComboById,
	getMyCombos,
	getMyCombos,
	getVendorCombos,
	getVendorCombosGrouped,
};
