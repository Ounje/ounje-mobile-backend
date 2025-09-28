const Vendor = require("../models/Vendor");
const Dish = require("../models/Dish");

// Get popular vendors
const getPopularVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find()
      .sort({ totalOrders: -1 })      // sort by rating 
      .limit(10)
      .select("name totalRating averageRating location isActive");

    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


module.exports = {
  getPopularVendors
};
