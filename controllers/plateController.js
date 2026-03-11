const mongoose = require("mongoose");
const { Plate, FoodItem, Combo, Customer } = require("../models");
const { paginate } = require("../utils/paginate");

const resolveItems = async (itemIds) => {
	if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) return [];
	const resolvedItems = [];

	for (const itemId of itemIds) {
		const objectId = new mongoose.Types.ObjectId(itemId);

		const foodItem = await FoodItem.findOne(
			{ "subCategory.items._id": objectId },
			{ "subCategory.$": 1, vendor: 1, category: 1 },
		).lean();

		if (!foodItem) continue;

		let specificItem = null;
		let subCategoryName = null;

		for (const subCat of foodItem.subCategory) {
			const found = subCat.items.find(
				(i) => i._id.toString() === itemId.toString(),
			);
			if (found) {
				specificItem = found;
				subCategoryName = subCat.name;
				break;
			}
		}

		if (!specificItem) continue;

		resolvedItems.push({
			itemId: specificItem._id,
			foodItemId: foodItem._id,
			category: foodItem.category,
			subCategoryName,
			name: specificItem.name,
			price: specificItem.price,
			img: specificItem.img,
			description: specificItem.description || null,
			preparationTime: specificItem.preparationTime || null,
			isAvailable: specificItem.isAvailable,
		});
	}

	return resolvedItems;
};

const buildPlate = async (req, res) => {
	try {
		let { name, description, items, vendor } = req.body;

		if (typeof items === "string") {
			try {
				items = JSON.parse(items);
			} catch {
				return res.status(400).json({ error: "Invalid items format." });
			}
		}

		if (!Array.isArray(items) || items.length === 0) {
			return res.status(400).json({ error: "At least one item is required." });
		}

		const customer = await Customer.findOne({ user: req.user.id });
		if (!customer) {
			return res.status(404).json({ error: "Customer profile not found" });
		}

		const resolvedItems = [];
		let totalPrice = 0;
		let maxTime = 0;
		const itemNames = [];

		for (const itemId of items) {
			const objectId = new mongoose.Types.ObjectId(itemId);

			const foodItem = await FoodItem.findOne(
				{ "subCategory.items._id": objectId },
				{ "subCategory.$": 1, vendor: 1, category: 1 },
			).lean();

			if (!foodItem) {
				return res.status(404).json({
					error: `No food item found containing itemId ${itemId}.`,
				});
			}

			let specificItem = null;
			for (const subCat of foodItem.subCategory) {
				const found = subCat.items.find(
					(i) => i._id.toString() === itemId.toString(),
				);
				if (found) {
					specificItem = found;
					break;
				}
			}

			if (!specificItem) {
				return res.status(404).json({
					error: `Item ${itemId} could not be resolved.`,
				});
			}

			resolvedItems.push(itemId);
			totalPrice += specificItem.price || 0;
			maxTime = Math.max(maxTime, parseInt(specificItem.preparationTime) || 0);
			itemNames.push(specificItem.name);
		}

		const comboIds = req.body.combos || [];
		const selectedCombos =
			comboIds.length > 0 ? await Combo.find({ _id: { $in: comboIds } }) : [];

		const combosTotal = selectedCombos.reduce(
			(sum, c) => sum + (c.basePrice || 0),
			0,
		);
		const price = totalPrice + combosTotal;
		const timeToMake = `${Math.max(maxTime, ...selectedCombos.map((c) => parseInt(c.time) || 0), 0)} mins`;

		const autoDescription = [
			...itemNames,
			...selectedCombos.map((c) => c.comboName),
		].join(", ");
		const finalDescription = description || autoDescription;

		const newPlate = await Plate.create({
			name,
			customer: customer._id,
			vendor,
			price,
			img: req.files?.file?.[0]?.path || undefined,
			timeToMake,
			items: resolvedItems,
			combos: selectedCombos.map((c) => c._id),
			description: finalDescription,
		});

		res.status(201).json(newPlate);
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

const getAllPlates = async (req, res) => {
	try {
		const populateOptions = [
			{ path: "combos", select: "-vendor -averageRating -ratingCount -likes" },
			{ path: "vendor", select: "storeDetails img description" },
			{ path: "customer", select: "firstName lastName img" },
		];

		const result = await paginate(Plate, req.query, populateOptions);

		const resolvedPlates = await Promise.all(
			result.data.map(async (plate) => {
				// Convert Mongoose doc to plain object if not already
				const plainPlate = plate.toObject ? plate.toObject() : plate;
				const resolvedItems = await resolveItems(plainPlate.items);
				return { ...plainPlate, items: resolvedItems };
			}),
		);

		res.status(200).json({ ...result, data: resolvedPlates });
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
};

const getSpecificPlate = async (req, res) => {
	try {
		const { plateId } = req.params;

		const plate = await Plate.findById(plateId)
			.populate("combos", "-vendor -averageRating -ratingCount -likes")
			.populate("vendor", "storeDetails img description")
			.populate("customer", "firstName lastName img")
			.lean();

		if (!plate) {
			return res.status(404).json({ error: "Plate not found" });
		}

		const resolvedItems = await resolveItems(plate.items);

		res.status(200).json({ ...plate, items: resolvedItems });
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
	getSpecificPlate,
	deletePlate,
	fixAllPlates,
};
