const Order = require("../models/Order");
const Vendor = require("../models/Vendor");
const Dish = require("../models/Dish");
const FoodItem = require("../models/FoodItem");
const Plate = require("../models/Plate");
const { calculateOunjeFee, identifyZone } = require('../utilis/delivery');


// Create a new order
exports.createOrder = async (req, res) => {
  try {
    const { items, vendorId, deliveryAddress } = req.body;
    const userId = req.user.id;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items in the order." });
    }

    // 1. Identify Zone
    const orderZone = identifyZone(deliveryAddress);

    // 2. Fetch Vendor
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!vendor.address) return res.status(400).json({ message: "Vendor has no address set" });

    // 3. Calculate Fee (Check for null!)
    const fee = await calculateOunjeFee(vendor.address, deliveryAddress);
    if (fee === null) {
      return res.status(400).json({ message: "Google Maps could not calculate distance. Check addresses." });
    }

    let itemsTotalPrice = 0; // Renamed for clarity
    const orderItems = [];
    const models = { FoodItem, Dish, Plate };

    for (const item of items) {
      const { itemId, itemType, quantity = 1, notes } = item;
      if (!itemId || !itemType || !models[itemType]) continue;

      const ProductModel = models[itemType];
      const product = await ProductModel.findById(itemId).select("price");

      if (product) {
        const itemPrice = product.price;
        itemsTotalPrice += (itemPrice * quantity);
        orderItems.push({
          itemType,
          item: itemId,
          quantity,
          price: itemPrice,
          notes,
        });
      }
    }

    // 4. Create Order (FIXED: using itemsTotalPrice + fee)
    const order = await Order.create({
      customer: userId,
      vendor: vendorId,
      items: orderItems,
      totalPrice: itemsTotalPrice + fee, 
      deliveryFee: fee,
      deliveryAddress,
      status: "pending",
      zone: orderZone,
    });

    return res.status(201).json({ success: true, order });

  } catch (error) {
    console.error("CRITICAL ERROR:", error);
    // This return ensures Postman STOPS loading and shows the error
    return res.status(500).json({ message: "Order failed", error: error.message });
  }
};

// ... other functions (getMyOrders, getOrderById, updateOrderStatus) remain the same ...
// ... (The rest of the file is omitted for brevity but should remain)
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate("vendor", "name")
      .populate("items.item");

    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching orders", error });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("vendor", "name")
      .populate("items.item");

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Ensure only the owner can access their order
    if (order.user.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: "Error fetching order", error });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only allow customer to cancel
    if (
      status === "cancelled" &&
      order.user.toString() !== req.user.id.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    order.status = status;
    await order.save();

    res.status(200).json({ message: "Order updated", order });
  } catch (error) {
    res.status(500).json({ message: "Failed to update order", error });
  }
};
