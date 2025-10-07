const Dish = require("../models/Dish");


const createDish = async (req, res) => {
    try {
    const { name, description, category, price, options } = req.body;
    const dish = new Dish({ name, description, category, price, options, vendor: req.user.id, img: req.file ? req.file.path : null });
    await dish.save();
    res.json(dish, { message: "Dish created successfully" });
    } catch (err) {
    res.status(400).json({ error: err.message });
    }
}


const getDishes = async (req, res) => {
  try {
    const dishes = await Dish.find({ isActive: true }).populate("vendor", "name location");  
    res.json(dishs);
    } catch (err) {
    res.status(500).json({ message: err.message });
    }
}

module.exports = { createDish };