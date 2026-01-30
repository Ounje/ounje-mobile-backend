const Vendor = require("../models/Vendor");
const FoodItem = require("../models/FoodItem");
const Combo = require("../models/Combo");
const { FOOD_ENUMS } = require("../utilis/foodEnums");

const createFoodItem = async (req, res) => {
	try {
		const { name, price, description, category, subCategory, preparationTime } =
			req.body;
		const vendorId = req.user.id;
		const vendor = await Vendor.findById(vendorId);
		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor not found." });
		if (!vendor.storeDetails || vendor.storeDetails.length === 0)
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
			vendor: vendorId,
			img: req.file.path,
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
		const foodItem = await FoodItem.findById(foodItemId);
		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found" });
		if (!foodItem.vendor.equals(req.user.id))
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
		const foodItem = await FoodItem.findById(foodItemId);
		if (!foodItem)
			return res
				.status(404)
				.json({ success: false, message: "Food item not found" });
		if (!foodItem.vendor.equals(req.user.id))
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
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 10;
		const skip = (page - 1) * limit;
		const total = await FoodItem.countDocuments({ isAvailable: true });
		const foodItems = await FoodItem.find({ isAvailable: true })
			.populate(
				"vendor",
				"storeDetails img description averageRating totalOrders",
			)
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit);
		res.status(200).json({
			success: true,
			count: foodItems.length,
			total,
			page,
			pages: Math.ceil(total / limit),
			data: foodItems,
		});
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
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 10;
		const skip = (page - 1) * limit;
		const total = await FoodItem.countDocuments({ vendor: req.user.id });
		const foodItems = await FoodItem.find({ vendor: req.user.id })
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit);
		res.status(200).json({
			success: true,
			count: foodItems.length,
			total,
			page,
			pages: Math.ceil(total / limit),
			data: foodItems,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
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
		} = req.body;
		const vendorId = req.user.id;
		const vendor = await Vendor.findById(vendorId);
		if (!vendor)
			return res
				.status(404)
				.json({ success: false, message: "Vendor not found." });
		if (!vendor.storeDetails || vendor.storeDetails.length === 0)
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

		let parsedSelections = selections || {};
		if (typeof selections === "string") {
			try {
				parsedSelections = JSON.parse(selections);
			} catch {
				return res
					.status(400)
					.json({ success: false, message: "Invalid selections format" });
			}
		}

		const combo = await Combo.create({
			comboName,
			description,
			basePrice,
			selections: parsedSelections,
			vendor: vendorId,
			img: req.file.path,
			time,
			deliveryTime,
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
		const combo = await Combo.findById(req.params.id);
		if (!combo)
			return res
				.status(404)
				.json({ success: false, message: "Combo not found" });
		if (!combo.vendor.equals(req.user.id))
			return res.status(403).json({
				success: false,
				message: "Not authorized to update this combo",
			});
		if (req.body.basePrice !== undefined && req.body.basePrice <= 0)
			return res
				.status(400)
				.json({ success: false, message: "Base price must be greater than 0" });

		if (req.body.selections && typeof req.body.selections === "string") {
			try {
				req.body.selections = JSON.parse(req.body.selections);
			} catch {
				return res
					.status(400)
					.json({ success: false, message: "Invalid selections format" });
			}
		}

		const { vendor, ...updateData } = req.body;
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
		const combo = await Combo.findById(req.params.id);
		if (!combo)
			return res
				.status(404)
				.json({ success: false, message: "Combo not found" });
		if (!combo.vendor.equals(req.user.id))
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
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 10;
		const skip = (page - 1) * limit;
		const total = await Combo.countDocuments();
		const combos = await Combo.find()
			.populate("vendor", " img description averageRating totalOrders")
			.populate({
				path: "selections.items.item",
				select: "name img description price"
			})
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit);
		res.status(200).json({
			success: true,
			count: combos.length,
			total,
			page,
			pages: Math.ceil(total / limit),
			data: combos,
		});
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
};

const getMyCombos = async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 10;
		const skip = (page - 1) * limit;
		const total = await Combo.countDocuments({ vendor: req.user.id });
		const combos = await Combo.find({ vendor: req.user.id })
			.populate({
				path: "selections.items.item",
				select: "name img description price"
			})
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit);
		res.status(200).json({
			success: true,
			count: combos.length,
			total,
			page,
			pages: Math.ceil(total / limit),
			data: combos,
		});
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
			});
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
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 10;
		const skip = (page - 1) * limit;

		const total = await Combo.countDocuments({ vendor: req.params.vendorId });

		const combos = await Combo.find({ vendor: req.params.vendorId })
			.populate("vendor", " img description averageRating totalOrders")
			.populate({
				path: "selections.items.item",
				select: "name img description price"
			})
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit);

		res.status(200).json({
			success: true,
			count: combos.length,
			total,
			page,
			pages: Math.ceil(total / limit),
			data: combos,
		});
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
	getVendorCombos,
};
