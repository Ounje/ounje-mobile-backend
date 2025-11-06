const Dish = require("../models/Dish");
const FoodItem = require("../models/FoodItem");
require("../models/FoodCategory"); 
require("../models/FoodItem");      
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
  const { dishId } = req.params;
  try {
    const dish = await Dish.findById(dishId).populate({
        path: "vendor",
        select: "name location ", 
      })
      .lean(); 
    if (!dish) return res.status(404).json({ message: "Dish not found" });
    res.json(dish);
  } catch (err) {
  res.status(500).json({ message: err.message });
  }
}

const deleteDish = async (req, res) => {
  const { dishId } = req.params;
  try {
    const dish = await Dish.findById(dishId);
    if (!dish) return res.status(404).json({ error: "dish not found" });
    if (!dish.vendor.equals(req.user.id)) return res.status(403).json({ error: "Not owner" });

    await dish.deleteOne();
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

const updateDish = async (req, res) => {
  const { dishId } = req.params;
  try {
    const dish = await Dish.findById(dishId);
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

const allItems = async (req, res) => {
  try {
    const items = await FoodItem.find();
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getFoodItemsByCategory = async (req,res) => {
  const category = req.params.category;
  try {
    const items = await FoodItem.find({
      category: { $regex: new RegExp(`^${category}$`, "i") }
    });
    
    if (!items.length) {
      return res.status(404).json({ message: "No food items found in this category" });
    }
    res.json(items);
  } catch (err) {
    throw new Error(err.message);
  } 
};

const getFoodItemById = async (req, res) => {
  const { foodItemId } = req.params;
  try {
    const item = await FoodItem.findById(foodItemId);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createFoodItem = async (req, res) => {
  try {
    const { name, category, price, description, sellingUnit } = req.body;
    const foodItem = new FoodItem({ name, category, price, description, sellingUnit,
    vendor: req.user.id, img: req.file ? req.file.path : null });
    await foodItem.save();
    res.json(foodItem, { message: "Food item created successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const deleteFoodItem = async (req, res) => {
  const { foodItemId } = req.params;
  try {
    const foodItem = await FoodItem.findById(foodItemId);
    if (!foodItem) return res.status(404).json({ error: "Food item not found" });
    if (!foodItem.vendor.equals(req.user.id)) return res.status(403).json({ error: "Not owner" });
    await foodItem.deleteOne();
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = { createDish, getDishes, getSpecificDish, deleteDish, updateDish, getFoodItemsByCategory, allItems , getFoodItemById,
  createFoodItem, deleteFoodItem,
};