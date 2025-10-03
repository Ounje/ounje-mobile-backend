const Dish = require("../models/Dish");


const createDish = async (req, res) => {
    try {
    const { name, description, category, price } = req.body;
    const dish = new Dish({ name, description, category, price, vendor: req.user.id, img: req.file ? req.file.path : null });
    await dish.save();
    res.json(dish, { message: "Dish created successfully" });
    } catch (err) {
    res.status(400).json({ error: err.message });
    }
}


module.exports = { createDish };