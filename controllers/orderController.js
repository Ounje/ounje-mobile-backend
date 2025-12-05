const Order = require("../models/Order");
const Vendor = require("../models/Vendor");
const Dish = require("../models/Dish");
const FoodItem = require("../models/FoodItem");
const Plate = require("../models/Plate");

// --- Import Mapbox Dependencies (Make sure these files exist!) ---
const { getCoordinatesFromAddress } = require("../utilis/location.utilis");
const { dispatchDriver } = require("../services/dispatch.service");
const db = require("../config/db"); // Use your actual database config/helper if needed

// Create a new order
exports.createOrder = async (req, res) => {
  try {
    const { items, vendorId, deliveryAddress } = req.body;
    console.log("Received order data:", req.body);
    // Assuming req.user.id is populated by middleware
    const userId = req.user.id;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items in the order." });
    }

    // --- MAPBOX STEP 1: GEOCoding (Address Validation) ---
    const coords = await getCoordinatesFromAddress(deliveryAddress);

    if (!coords) {
      return res
        .status(400)
        .json({
          message:
            "Invalid or unroutable delivery address. Please check and try again.",
        });
    }

    let totalPrice = 0;
    const orderItems = [];
    const models = { FoodItem, Dish, Plate }; // Map itemType strings to Mongoose Models

    for (const item of items) {
      const { itemId, itemType, quantity = 1, notes } = item;

      // 1. Basic Validation
      if (!itemId || !itemType || !models[itemType]) {
        return res
          .status(400)
          .json({
            message: `Invalid item structure for item: ${JSON.stringify(item)}`,
          });
      }

      // 2. Fetch the actual product from the database
      const ProductModel = models[itemType];
      const product = await ProductModel.findById(itemId).select("price");

      if (!product) {
        return res
          .status(404)
          .json({ message: `Product not found for ID: ${itemId}` });
      }
      const itemPrice = product.price;
      const calculatedItemTotal = itemPrice * quantity;
      totalPrice += calculatedItemTotal;

      // 3. Construct the order item to match the Mongoose schema
      orderItems.push({
        itemType,
        item: itemId, // This is the ObjectId reference
        quantity,
        price: itemPrice, // Store the price at the time of order
        notes,
      });
    }

    // 2. Save the order with GEOCodes
    const order = await Order.create({
      customer: userId,
      vendor: vendorId,
      items: orderItems, // <-- Use the validated/mapped array
      totalPrice,
      deliveryAddress,
      // --- EXISTING: Store Mapbox Coordinates in the Order Document ---
      deliveryLatitude: coords.latitude,
      deliveryLongitude: coords.longitude,
      // --- End EXISTING ---
      status: "pending", // Initial status before dispatch
    });

    // --- MAPBOX STEP 2: Dispatch (Matrix API) ---
    // We call the dispatch service here, which will find the best rider.
    const assignedRider = await dispatchDriver(order);

    // --- NEW: Handle Dispatch Result for Response ---
    if (assignedRider) {
      // Dispatch was successful (dispatchDriver should have updated status to 'Rider Assigned')
      res.status(201).json({
        message: "Order created and Rider assigned successfully",
        order: {
          ...order.toObject(),
          riderId: assignedRider._id, // Add the rider ID to the response
          status: "Rider Assigned",
        },
      });
    } else {
      // Dispatch failed (no riders available). Keep status as 'pending' or update to 'awaiting_rider'
      await Order.findByIdAndUpdate(order._id, { status: "awaiting_rider" });

      res.status(202).json({
        message: "Order created. No riders currently available. Searching...",
        order: {
          ...order.toObject(),
          status: "awaiting_rider",
        },
      });
    }
  } catch (error) {
    console.error("Order creation error:", error);
    res
      .status(500)
      .json({ message: "Failed to create order", error: error.message });
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
