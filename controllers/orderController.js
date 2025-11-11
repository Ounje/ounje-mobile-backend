const Order = require("../models/Order");
const Vendor = require("../models/Vendor");
const Dish = require("../models/Dish");
const FoodItem = require("../models/FoodItem");
const Plate = require("../models/Plate");

// Create a new order
exports.createOrder = async (req, res) => {
  try {
    const { items, vendorId, deliveryAddress } = req.body;
    const userId = req.user._id; // from authMiddleware

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items in the order." });
    }

    let totalPrice = 0;

    // Calculate total price dynamically
    for (const item of items) {
      totalPrice += item.price * (item.quantity || 1);
    }

    const order = await Order.create({
      user: userId,
      vendor: vendorId,
      items,
      totalPrice,
      deliveryAddress,
      status: "pending",
    });

    res.status(201).json({
      message: "Order created successfully",
      order,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to create order", error });
  }
};

// Get all orders of the logged-in customer
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate("vendor", "name")
      .populate("items.item");

    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching orders", error });
  }
};

// Get a single order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("vendor", "name")
      .populate("items.item");

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Ensure only the owner can access their order
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: "Error fetching order", error });
  }
};

// Update order status (e.g., cancel or mark completed)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only allow customer to cancel
    if (status === "cancelled" && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    order.status = status;
    await order.save();

    res.status(200).json({ message: "Order updated", order });
  } catch (error) {
    res.status(500).json({ message: "Failed to update order", error });
  }
};
