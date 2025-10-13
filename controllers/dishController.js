const Dish = require("../models/Dish");


const createDish = async (req, res) => {
    try {
    const { name, description, category, price, options, time, minPrice, deliveryTime, likes, rating } = req.body;
    const dish = new Dish({ name, description, category, price, options,
    vendor: req.user.id, img: req.file ? req.file.path : null, time, minPrice, deliveryTime, likes, rating });
    await dish.save();
    res.json(dish, { message: "Dish created successfully" });
    } catch (err) {
    res.status(400).json({ error: err.message });
    }
}


const getDishes = async (req, res) => {
  try {
    const dishes = await Dish.find({ isActive: true }).populate("vendor", "name location");  
    res.json(dishes);
    } catch (err) {
    res.status(500).json({ message: err.message });
    }
}

const getSpecificDish = async (req, res) => {
  const { id } = req.params;
  try {
    const dish = await Dish.findById(id).populate("vendor", "name location");  
    if (!dish) return res.status(404).json({ message: "Dish not found" });
    res.json(dish);
  } catch (err) {
  res.status(500).json({ message: err.message });
  }
}

module.exports = { createDish, getDishes, getSpecificDish };