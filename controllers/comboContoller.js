const Combo = require("../models/Combo");


// Get popular dishes
const getPopularCombos = async (req, res) => {
  try {
    const dishes = await Combo.find()
      .sort({ averageRating: -1 }) // sort by order count
      .limit(10)
      .select("name description price averageRating totalRating")

    res.json(dishes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getPopularCombos
};
