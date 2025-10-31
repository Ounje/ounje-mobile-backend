const Plate = require("../models/Plate");

const buildPlate = async (req, res) => {
    try {
        const { name, customer, price, timeToMake, options } = req.body;
        // Logic to build a plate using plateData
        const newPlate = await Plate.create({ 
            name, 
            customer, 
            price,
            timeToMake,
            options
        });
        res.status(201).json(newPlate);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    buildPlate,
};