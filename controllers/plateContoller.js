const Plate = require("../models/Plate");
const FoodItem = require("../models/FoodItem");
const { deleteImage } = require("../config/cloudinary");

const buildPlate = async (req, res) => {
    try {
        const { name, price, timeToMake, items, vendor } = req.body;
        
        // Fetch item names to create the description
        // 'items' is likely an array of IDs from the frontend
        const selectedItems = await FoodItem.find({ _id: { $in: items } });
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
        const plates = await Plate.find();
        res.status(200).json(plates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getSpecificPlate = async (req, res) => {
    try {
        const { plateId } = req.params;
        const plate = await Plate.findById(plateId);
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
        if(req.user.id !== plate.customer.toString()){
            return  res.status(403).json({ error: "Forbidden: You can only delete your own plates" });
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

module.exports = {
    buildPlate, getAllPlates, getSpecificPlate, deletePlate
};