const { Plate, FoodItem } = require("../models");
const { deleteImage } = require("../config/cloudinary");
const { paginate } = require("../utils/paginate");

const buildPlate = async (req, res) => {
    try {
        const { name, price, timeToMake, items, vendor } = req.body;

        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                // if it's just a single ID string, wrap it in an array
                items = [items];
            }
        }

        // Fetch item names to create the description
        // 'items' is likely an array of IDs from the frontend
        const selectedItems = await FoodItem.find({ _id: { $in: items } });

        // Debugging: See if items are actually being found in your terminal
        console.log("Items found in DB:", selectedItems.length);

        const description = selectedItems.map(item => item.name).join(", ");

        // Logic to build a plate using plateData
        const newPlate = await Plate.create({
            name,
            customer: req.user.id,
            vendor,
            price,
            img: req.file ? req.file.path : undefined,
            timeToMake,
            items,
            description
        });
        res.status(201).json(newPlate);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getAllPlates = async (req, res) => {
    try {
        const populateOptions = [
            "items",
            { path: "vendor", select: "storeDetails img description" },
            { path: "customer", select: "firstName lastName img" }
        ];

        const result = await paginate(Plate, req.query, populateOptions);

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getSpecificPlate = async (req, res) => {
    try {
        const { plateId } = req.params;
        const plate = await Plate.findById(plateId)
            .populate("items")
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
        const plate = await Plate.findById(plateId);
        if (!plate) {
            return res.status(404).json({ error: "Plate not found" });
        }
        console.log(plate.customer.toString())
        if (req.user.id !== plate.customer.toString()) {
            return res.status(403).json({ error: "Forbidden: You can only delete your own plates" });
        }
        if (plate.img) {
            const publicId = plate.img.split('/').pop().split('.')[0];
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

            // 3. Create the description string
            const description = selectedItems.map(item => item.name).join(", ");

            // 4. Update the plate in the DB
            plate.description = description;
            await plate.save();
        }

        res.status(200).json({ message: "All existing plates have been updated with descriptions!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    buildPlate, getAllPlates, getSpecificPlate, deletePlate, fixAllPlates
};