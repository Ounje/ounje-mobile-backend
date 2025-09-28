const express = require("express");
const Order = require("../models/Order");
const Dish = require("../models/Dish");
const { authMiddleware, roleGuard } = require("../middleware/auth");

const router = express.Router();

router.post("/", authMiddleware, roleGuard(["customer"]), async (req, res) => {
  try {
    const { seller, items, deliveryAddress } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: "No items" });

    const builtItems = [];
    let total = 0;
    for (const it of items) {
      const dish = await Dish.findById(it.dish);
      if (!dish) return res.status(400).json({ error: `dish not found: ${it.dish}` });
      builtItems.push({ dish: dish._id, name: dish.name, price: dish.price, quantity: it.quantity || 1 });
      total += dish.price * (it.quantity || 1);
    }

    const order = new Order({
      customer: req.user._id,
      seller,
      items: builtItems,
      totalPrice: total,
      deliveryAddress,
      status: "pending"
    });
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// for customers to view their orders
router.get("/customer", authMiddleware, roleGuard(["customer"]), async (req, res) => {
  const orders = await Order.find({ customer: req.user._id }).populate("seller", "name location").populate("rider", "name phone");
  res.json(orders);
});

// for sellers to view the orders they'll be sending out 
router.get("/seller", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  const orders = await Order.find({ seller: req.user._id }).populate("customer", "name phone").populate("rider", "name phone");
  res.json(orders);
});

// for sellers to confirm or cancel an order
router.put("/:id/status", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const { status } = req.body; // accepted values: 'confirmed' or 'cancelled'
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.seller.equals(req.user._id)) return res.status(403).json({ error: "Not seller of this order" });

    if (!["confirmed", "cancelled"].includes(status)) return res.status(400).json({ error: "Invalid status" });
    order.status = status;
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// for riders to view confirmed and unassigned orders
router.get("/available", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  const orders = await Order.find({ status: "confirmed", rider: null }).populate("seller", "name location").populate("customer", "name location");
  res.json(orders);
});

// for riders to claim an order
router.post("/:id/assign", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.rider) return res.status(400).json({ error: "Order already assigned" });
    if (order.status !== "confirmed") return res.status(400).json({ error: "Order must be confirmed by seller first" });

    order.rider = req.user._id;
    order.status = "assigned";
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// for riders to update status to out_for_delivery / delivered and optionally update rider location 
router.put("/:id/rider-update", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  try {
    const { status, riderLocation } = req.body; // status: 'out_for_delivery' | 'delivered'
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.rider || !order.rider.equals(req.user._id)) return res.status(403).json({ error: "Not assigned to you" });

    if (status && !["out_for_delivery", "delivered"].includes(status)) {
      return res.status(400).json({ error: "Invalid rider status" });
    }

    if (status) order.status = status;
    if (riderLocation && riderLocation.lat && riderLocation.lng) {
      order.riderLocation = { lat: riderLocation.lat, lng: riderLocation.lng, updatedAt: new Date() };

      // Also update rider's own last location in user model (optional)
      req.user.riderStatus = req.user.riderStatus || {};
      req.user.riderStatus.lastLocation = { lat: riderLocation.lat, lng: riderLocation.lng, updatedAt: new Date() };
      await req.user.save();
    }

    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//for riders to view their orders 
router.get("/rider", authMiddleware, roleGuard(["rider"]), async (req, res) => {
  const orders = await Order.find({ rider: req.user._id }).populate("customer", "name phone").populate("seller", "name location");
  res.json(orders);
});

module.exports = router;
