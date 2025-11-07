const Vendor = require("../models/Vendor");
const Dish = require("../models/Dish");

// Get popular vendors
const getPopularVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find()
      .sort({ totalOrders: -1 })  
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

//Vendor side
//This is for getting the vendor's own details along with their menu
//you can only access this route if you're logged in as a vendor
const getVendor = async(req, res) => {
  try{
    const vendorId = req.user.id;
    const vendor = await Vendor.findById(vendorId).populate('menu');
    if(!vendor) return res.status(404).json({message: "Vendor not found"});
    res.json(vendor);
  }catch(err){
    res.status(500).json({ message: err.message });
  }
}

//Customer side
//with this you'll get the vendor details along with their menu and options
const userGetVendor = async(req, res) => {
  try{
    const vendorId = req.params.id;
    const vendor = await Vendor.findById(vendorId)
    .populate("menu")
    .populate("foodItems")
    .select("-email -role -img -__v -createdAt -updatedAt ");
    if(!vendor) return res.status(404).json({message: "Vendor not found"});
    res.json(vendor);
  }catch(err){
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getPopularVendors,
  getVendor,
  userGetVendor,
};
