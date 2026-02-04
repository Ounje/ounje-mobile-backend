const { Customer } = require("../models");

const getCustomerProfile = async (req, res) => {
  const customerId = req.user.id;
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(customer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
};

const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.id;

    // Use Customer instead of User to match your import
    await Customer.findByIdAndUpdate(userId, { fcmToken });

    res.status(200).json({ success: true, message: "Device token saved!" });
  } catch (error) {
    res.status(500).json({ message: "Failed to save token" });
  }
};

module.exports = { getCustomerProfile, updateFcmToken };