const Vendor = require("../models/Vendor");
const FoodItem = require("../models/FoodItem");
const Combo = require("../models/Dish");
const { FOOD_ENUMS } = require("../utilis/foodEnums");

const createFoodItem = async (req, res) => {
	try {
		const { name, price, description, category, subCategory, preparationTime } =
			req.body;
		const vendorId = req.user.id;

		// Check vendor profile
		const vendor = await Vendor.findById(vendorId);
		if (!vendor) {
			return res.status(404).json({
				success: false,
				message: "Vendor not found.",
			});
		}

		if (!vendor.storeDetails || vendor.storeDetails.length === 0) {
			return res.status(403).json({
				success: false,
				message:
					"Please complete your vendor profile before creating food items.",
			});
		}
		//TODO
		// if (vendor.storeDetails[0].status === "pending") {
		// 	return res.status(403).json({
		// 		success: false,
		// 		message: "Your account is pending.Please contact support",
		// 	});
		// }

		// Validate required fields
		if (!name || !price || !category || !preparationTime) {
			return res.status(400).json({
				success: false,
				message: "Name, price, category, and preparationTime are required.",
			});
		}

		if (price <= 0) {
			return res.status(400).json({
				success: false,
				message: "Price must be greater than 0",
			});
		}

		const validCategories = Object.values(FOOD_ENUMS.CATEGORIES);
		if (!validCategories.includes(category)) {
			return res.status(400).json({
				success: false,
				message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
			});
		}

		if (subCategory) {
			const validSubCategories = Object.values(FOOD_ENUMS.SUB_CATEGORIES);
			if (!validSubCategories.includes(subCategory)) {
				return res.status(400).json({
					success: false,
					message: `Invalid subCategory. Must be one of: ${validSubCategories.join(", ")}`,
				});
			}
		}

		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Image is required",
			});
		}

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
		console.error("Create Food Item Error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const updateFoodItem = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const foodItem = await FoodItem.findById(foodItemId);

		if (!foodItem) {
			return res.status(404).json({
				success: false,
				message: "Food item not found",
			});
		}

		if (!foodItem.vendor.equals(req.user.id)) {
			return res.status(403).json({
				success: false,
				message: "Not authorized. You don't own this food item.",
			});
		}

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
			if (!validCategories.includes(req.body.category)) {
				return res.status(400).json({
					success: false,
					message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
				});
			}
		}

		if (req.body.subCategory) {
			const validSubCategories = Object.values(FOOD_ENUMS.SUB_CATEGORIES);
			if (!validSubCategories.includes(req.body.subCategory)) {
				return res.status(400).json({
					success: false,
					message: `Invalid subCategory. Must be one of: ${validSubCategories.join(", ")}`,
				});
			}
		}

		allowedFields.forEach((field) => {
			if (req.body[field] !== undefined) {
				foodItem[field] = req.body[field];
			}
		});

		if (req.file) {
			foodItem.img = req.file.path;
		}

		await foodItem.save();

		res.json({
			success: true,
			message: "Food item updated successfully",
			data: foodItem,
		});
	} catch (err) {
		console.error("Update Food Item Error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const deleteFoodItem = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const foodItem = await FoodItem.findById(foodItemId);

		if (!foodItem) {
			return res.status(404).json({
				success: false,
				message: "Food item not found",
			});
		}

		if (!foodItem.vendor.equals(req.user.id)) {
			return res.status(403).json({
				success: false,
				message: "Not authorized. You don't own this food item.",
			});
		}

		// Check if item is used in any combos
		const combosUsingItem = await Combo.find({
			"items.foodItem": foodItemId,
			vendor: req.user.id,
		});

		if (combosUsingItem.length > 0) {
			return res.status(400).json({
				success: false,
				message: `Cannot delete. This item is used in ${combosUsingItem.length} combo(s). Remove it from combos first.`,
				combos: combosUsingItem.map((c) => ({
					id: c._id,
					name: c.comboName,
				})),
			});
		}

		await foodItem.deleteOne();

		res.json({
			success: true,
			message: "Food item deleted successfully",
		});
	} catch (err) {
		console.error("Delete Food Item Error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const getAllFoodItems = async (req, res) => {
	try {
		const {
			category,
			subCategory,
			vendor,
			search,
			page = 1,
			limit = 10,
		} = req.query;
		const filter = { isAvailable: true };

		if (category) filter.category = category;
		if (subCategory) filter.subCategory = subCategory;
		if (vendor) filter.vendor = vendor;
		if (search) filter.name = { $regex: search, $options: "i" };

		const skip = (Number(page) - 1) * Number(limit);

		const foodItems = await FoodItem.find(filter)
			.populate("vendor", "name")
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(Number(limit));

		res.status(200).json({
			success: true,
			count: foodItems.length,
			data: foodItems,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const getFoodItemById = async (req, res) => {
	try {
		const { foodItemId } = req.params;
		const foodItem = await FoodItem.findById(foodItemId).populate(
			"vendor",
			"name",
		);

		if (!foodItem) {
			return res.status(404).json({
				success: false,
				message: "Food item not found",
			});
		}

		res.status(200).json({
			success: true,
			data: foodItem,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const getMyFoodItems = async (req, res) => {
	try {
		const vendorId = req.user.id;
		const { page = 1, limit = 10 } = req.query;

		const skip = (Number(page) - 1) * Number(limit);

		const foodItems = await FoodItem.find({ vendor: vendorId })
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(Number(limit));

		res.status(200).json({
			success: true,
			count: foodItems.length,
			data: foodItems,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const createCombo = async (req, res) => {
	try {
		const {
			comboName,
			description,
			category,
			subCategory,
			time,
			deliveryTime,
			items,
		} = req.body;
		const vendorId = req.user.id;

		const vendor = await Vendor.findById(vendorId);
		if (!vendor) {
			return res.status(404).json({
				success: false,
				message: "Vendor not found.",
			});
		}

		if (!vendor.storeDetails || vendor.storeDetails.length === 0) {
			return res.status(403).json({
				success: false,
				message: "Please complete your vendor profile before creating combos.",
			});
		}

		//TODO
		// if (vendor.storeDetails[0].status === "pending") {
		// 	return res.status(403).json({
		// 		success: false,
		// 		message: "Your account is pending .Please contact support",
		// 	});
		// }

		// Validate required fields
		if (!comboName || !time || !items) {
			return res.status(400).json({
				success: false,
				message: "Combo name, time, and items are required.",
			});
		}

		// Validate category if provided
		if (category) {
			const validCategories = Object.values(FOOD_ENUMS.CATEGORIES);
			if (!validCategories.includes(category)) {
				return res.status(400).json({
					success: false,
					message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
				});
			}
		}

		// Validate subCategory if provided
		if (subCategory) {
			const validSubCategories = Object.values(FOOD_ENUMS.SUB_CATEGORIES);
			if (!validSubCategories.includes(subCategory)) {
				return res.status(400).json({
					success: false,
					message: `Invalid subCategory. Must be one of: ${validSubCategories.join(", ")}`,
				});
			}
		}

		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Image is required",
			});
		}

		let parsedItems = items;
		if (typeof items === "string") {
			try {
				parsedItems = JSON.parse(items);
			} catch (err) {
				return res.status(400).json({
					success: false,
					message: "Invalid items format. Must be valid JSON.",
				});
			}
		}

		if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
			return res.status(400).json({
				success: false,
				message: "Combo must have at least one item.",
			});
		}

		for (let item of parsedItems) {
			if (item.foodItem) {
				const foodItem = await FoodItem.findById(item.foodItem);
				if (!foodItem) {
					return res.status(400).json({
						success: false,
						message: `Food item ${item.foodItem} not found.`,
					});
				}
				if (!foodItem.vendor.equals(vendorId)) {
					return res.status(403).json({
						success: false,
						message: `You don't own food item: ${foodItem.name}`,
					});
				}
			} else {
				if (!item.name || !item.unitPrice) {
					return res.status(400).json({
						success: false,
						message: "New items must have name and unitPrice.",
					});
				}
				if (item.unitPrice <= 0) {
					return res.status(400).json({
						success: false,
						message: "Unit price must be greater than 0.",
					});
				}
			}

			if (!item.quantity || item.quantity <= 0) {
				return res.status(400).json({
					success: false,
					message: "Each item must have quantity greater than 0.",
				});
			}
		}

		const combo = new Combo({
			comboName,
			description,
			category,
			subCategory,
			time,
			deliveryTime,
			items: parsedItems,
			vendor: vendorId,
			img: req.file.path,
		});

		await combo.save();
		await combo.populate("items.foodItem");

		res.status(201).json({
			success: true,
			message: "Combo created successfully",
			data: {
				...combo.toObject(),
				computedPrice: combo.computedPrice,
			},
		});
	} catch (err) {
		console.error("Create Combo Error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const updateCombo = async (req, res) => {
	try {
		const { comboId } = req.params;
		const combo = await Combo.findById(comboId);

		if (!combo) {
			return res.status(404).json({
				success: false,
				message: "Combo not found",
			});
		}

		if (!combo.vendor.equals(req.user.id)) {
			return res.status(403).json({
				success: false,
				message: "Not authorized. You don't own this combo.",
			});
		}

		const allowedFields = [
			"comboName",
			"description",
			"category",
			"subCategory",
			"time",
			"deliveryTime",
			"items",
			"isActive",
		];

		if (req.body.category) {
			const validCategories = Object.values(FOOD_ENUMS.CATEGORIES);
			if (!validCategories.includes(req.body.category)) {
				return res.status(400).json({
					success: false,
					message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
				});
			}
		}

		if (req.body.subCategory) {
			const validSubCategories = Object.values(FOOD_ENUMS.SUB_CATEGORIES);
			if (!validSubCategories.includes(req.body.subCategory)) {
				return res.status(400).json({
					success: false,
					message: `Invalid subCategory. Must be one of: ${validSubCategories.join(", ")}`,
				});
			}
		}

		if (req.body.items) {
			let parsedItems = req.body.items;
			if (typeof parsedItems === "string") {
				try {
					parsedItems = JSON.parse(parsedItems);
				} catch (err) {
					return res.status(400).json({
						success: false,
						message: "Invalid items format.",
					});
				}
			}

			if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
				return res.status(400).json({
					success: false,
					message: "Combo must have at least one item.",
				});
			}

			for (let item of parsedItems) {
				if (item.foodItem) {
					const foodItem = await FoodItem.findById(item.foodItem);
					if (!foodItem) {
						return res.status(400).json({
							success: false,
							message: `Food item ${item.foodItem} not found.`,
						});
					}
					if (!foodItem.vendor.equals(req.user.id)) {
						return res.status(403).json({
							success: false,
							message: `You don't own food item: ${foodItem.name}`,
						});
					}
				} else {
					if (!item.name || !item.unitPrice) {
						return res.status(400).json({
							success: false,
							message: "New items must have name and unitPrice.",
						});
					}
				}

				if (!item.quantity || item.quantity <= 0) {
					return res.status(400).json({
						success: false,
						message: "Quantity must be greater than 0.",
					});
				}
			}

			req.body.items = parsedItems;
		}

		allowedFields.forEach((field) => {
			if (req.body[field] !== undefined) {
				combo[field] = req.body[field];
			}
		});

		if (req.file) {
			combo.img = req.file.path;
		}

		await combo.save();
		await combo.populate("items.foodItem");

		res.json({
			success: true,
			message: "Combo updated successfully",
			data: {
				...combo.toObject(),
				computedPrice: combo.computedPrice,
			},
		});
	} catch (err) {
		console.error("Update Combo Error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const deleteCombo = async (req, res) => {
	try {
		const { comboId } = req.params;
		const combo = await Combo.findById(comboId);

		if (!combo) {
			return res.status(404).json({
				success: false,
				message: "Combo not found",
			});
		}

		if (!combo.vendor.equals(req.user.id)) {
			return res.status(403).json({
				success: false,
				message: "Not authorized. You don't own this combo.",
			});
		}

		await combo.deleteOne();

		res.json({
			success: true,
			message: "Combo deleted successfully",
		});
	} catch (err) {
		console.error("Delete Combo Error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const getAllCombos = async (req, res) => {
	try {
		const {
			category,
			subCategory,
			vendor,
			search,
			page = 1,
			limit = 10,
		} = req.query;
		const filter = { isAvailable: true };

		if (category) filter.category = category;
		if (subCategory) filter.subCategory = subCategory;
		if (vendor) filter.vendor = vendor;
		if (search) filter.comboName = { $regex: search, $options: "i" };

		const skip = (Number(page) - 1) * Number(limit);

		const combos = await Combo.find(filter)
			.populate("vendor", "name")
			.populate("items.foodItem")
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(Number(limit));

		res.status(200).json({
			success: true,
			count: combos.length,
			data: combos,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const getComboById = async (req, res) => {
	try {
		const { comboId } = req.params;
		const combo = await Combo.findById(comboId)
			.populate("vendor", "name")
			.populate("items.foodItem");

		if (!combo) {
			return res.status(404).json({
				success: false,
				message: "Combo not found",
			});
		}

		res.status(200).json({
			success: true,
			data: {
				...combo.toObject(),
				computedPrice: combo.computedPrice,
			},
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const getMyCombos = async (req, res) => {
	try {
		const vendorId = req.user.id;
		const { page = 1, limit = 10 } = req.query;

		const skip = (Number(page) - 1) * Number(limit);

		const combos = await Combo.find({ vendor: vendorId })
			.populate("items.foodItem")
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(Number(limit));

		res.status(200).json({
			success: true,
			count: combos.length,
			data: combos,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
		});
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
};
