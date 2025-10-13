const Dish = require("../models/Dish");
require("../models/OptionCategory"); 
require("../models/OptionItem");      
require("../models/Vendor");  

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
    const dish = await Dish.findById(id).populate({
        path: "vendor",
        select: "name location ", 
      })
      .populate({
        path: "options",
        populate: {
          path: "items",
          model: "OptionItem",
        },
      })
      .lean(); 
    if (!dish) return res.status(404).json({ message: "Dish not found" });
    res.json(dish);
  } catch (err) {
  res.status(500).json({ message: err.message });
  }
}

const deleteDish = async (req, res) => {
  const { id } = req.params;
  try {
    const dish = await Dish.findById(id);
    if (!dish) return res.status(404).json({ error: "dish not found" });
    if (!dish.vendor.equals(req.user.id)) return res.status(403).json({ error: "Not owner" });

    await dish.deleteOne();
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

const updateDish = async (req, res) => {
  const { id } = req.params;
  try {
    const dish = await Dish.findById(id);
    if (!dish) return res.status(404).json({ error: "dish not found" });

    if (!dish.vendor.equals(req.user.id)) {
      return res.status(403).json({ error: "Not owner" });
    }
    const allowedFields = ["name", "description", "price", "category", "deliveryTime", "minPrice", "isActive"];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        dish[field] = req.body[field];
      }
    });

    await dish.save();
    res.json(dish);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { createDish, getDishes, getSpecificDish, deleteDish, updateDish };