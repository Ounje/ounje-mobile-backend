const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const Dish = require("../models/Dish");
const Order = require("../models/Order");

const {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderStatus,
} = require("../controllers/orderController");

const router = express.Router();

/* ======================
   CUSTOMER ROUTES
====================== */

// Create new order (customer)
router.post("/", authMiddleware, roleGuard(["customer"]), createOrder);

// Get all orders of logged-in customer
router.get("/", authMiddleware, roleGuard(["customer"]), getMyOrders);

// Get a specific order by ID (customer)
router.get("/:id", authMiddleware, roleGuard(["customer"]), getOrderById);

// Update order status (e.g., cancel) (customer)
router.put("/:id", authMiddleware, roleGuard(["customer"]), updateOrderStatus);


/* ======================
   SELLER ROUTES
====================== */

// View orders for seller
router.get("/seller", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const orders = await Order.find({ vendor: req.user._id })
      .populate("user", "name phone")
      .populate("items.item");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update order status (confirm/cancel) (seller)
router.put("/:id/status", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const { status } = req.body; // accepted: confirmed or cancelled
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.vendor.equals(req.user._id)) return res.status(403).json({ error: "Not vendor of this order" });

    if (!["confirmed", "cancelled"].includes(status))
      return res.status(400).json({ error: "Invalid status" });

    order.status = status;
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ======================
   RIDER ROUTES
====================== */

// View available orders (confirmed, unassigned)
router.get("/available", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  try {
    const orders = await Order.find({ status: "confirmed", rider: null })
      .populate("vendor", "name location")
      .populate("user", "name location");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claim an order (rider)
router.post("/:id/assign", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.rider) return res.status(400).json({ error: "Order already assigned" });
    if (order.status !== "confirmed") return res.status(400).json({ error: "Order must be confirmed first" });

    order.rider = req.user._id;
    order.status = "assigned";
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update order status and optionally rider location
router.put("/:id/rider-update", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  try {
    const { status, riderLocation } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.rider || !order.rider.equals(req.user._id)) return res.status(403).json({ error: "Not assigned to you" });

    if (status && !["out_for_delivery", "delivered"].includes(status))
      return res.status(400).json({ error: "Invalid rider status" });

    if (status) order.status = status;
    if (riderLocation?.lat && riderLocation?.lng) {
      order.riderLocation = { lat: riderLocation.lat, lng: riderLocation.lng, updatedAt: new Date() };
    }

    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View rider's own orders
router.get("/rider", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  try {
    const orders = await Order.find({ rider: req.user._id })
      .populate("user", "name phone")
      .populate("vendor", "name location");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
