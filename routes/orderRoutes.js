const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const Combo = require("../models/Combo");
const Order = require("../models/Order");
const Rider = require("../models/Rider");
const Vendor = require("../models/Vendor");

const {
	createOrder,
	getMyOrders,
	getOrderById,
	updateOrderStatus,
	sendDeliveryOtp,
	verifyDeliveryOtp,
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
router.get(
	"/seller",
	authMiddleware,
	roleGuard(["vendor"]),
	async (req, res) => {
		try {
			const orders = await Order.find({ vendor: req.user.id })
				.populate("user", "name phone")
				.populate("items.item");
			res.json(orders);
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	},
);

// Update order status (confirm/cancel) (seller)
router.put(
	"/:id/status",
	authMiddleware,
	roleGuard(["vendor"]),
	async (req, res) => {
		try {
			const { status } = req.body; // accepted: confirmed or cancelled
			const order = await Order.findById(req.params.id);
			if (!order) return res.status(404).json({ error: "Order not found" });
			if (!order.vendor.equals(req.user.id))
				return res.status(403).json({ error: "Not vendor of this order" });

			if (!["confirmed", "cancelled"].includes(status))
				return res.status(400).json({ error: "Invalid status" });

			order.status = status;
			await order.save();
			res.json(order);
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	},
);

/* ======================
   RIDER ROUTES
====================== */

// View available orders (confirmed, unassigned)
router.get(
	"/available",
	authMiddleware,
	roleGuard(["rider"]),
	async (req, res) => {
		try {
			// Get the rider's operating areas (Max 2 zones)
			const rider = await Rider.findById(req.user.id);

			// ONLY find orders that match the rider's zones
			const orders = await Order.find({
				status: "pending", // or "confirmed"
				rider: null,
				zone: { $in: rider.operatingArea }, // Filter by the Rider's 2 zones
			})
				.populate("vendor", "name deliveryAddress")
				.populate("customer", "name deliveryAddress");

			res.json(orders);
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	},
);

// Claim an order (rider)
router.post(
	"/:id/assign",
	authMiddleware,
	roleGuard(["rider"]),
	async (req, res) => {
		try {
			const order = await Order.findById(req.params.id);
			if (!order) return res.status(404).json({ error: "Order not found" });
			if (order.rider)
				return res.status(400).json({ error: "Order already assigned" });
			if (order.status !== "confirmed")
				return res.status(400).json({ error: "Order must be confirmed first" });

			order.rider = req.user.id;
			order.status = "assigned";
			await order.save();
			res.json(order);
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	},
);

// Update order status and optionally rider location
router.put(
	"/:id/rider-update",
	authMiddleware,
	roleGuard(["rider"]),
	async (req, res) => {
		try {
			const { status, riderLocation, otp } = req.body;
			const order = await Order.findById(req.params.id);
			if (!order) return res.status(404).json({ error: "Order not found" });
			if (!order.rider || !order.rider.equals(req.user.id))
				return res.status(403).json({ error: "Not assigned to you" });

			if (status && !["out_for_delivery", "delivered"].includes(status))
				return res.status(400).json({ error: "Invalid rider status" });

			// When rider picks up (out_for_delivery) -> send OTP to customer
			if (status === "out_for_delivery") {
				order.status = status;
				if (riderLocation?.lat && riderLocation?.lng) {
					order.riderLocation = {
						lat: riderLocation.lat,
						lng: riderLocation.lng,
						updatedAt: new Date(),
					};
				}
				await order.save();

				try {
					await sendDeliveryOtp(order);
				} catch (e) {
					console.error("Failed to send delivery OTP:", e.message);
				}

				return res.json({
					message: "OTP sent to customer and order updated",
					order,
				});
			}

			// When delivered -> verify OTP (required) then complete order and trigger payouts
			if (status === "delivered") {
				if (!otp)
					return res
						.status(400)
						.json({ error: "OTP required to confirm delivery" });

				const verified = await verifyDeliveryOtp(order, otp, req.user.id);
				if (!verified.success) {
					return res.status(400).json({ error: "Invalid OTP" });
				}

				// Refresh order after verification
				const updated = await Order.findById(req.params.id);
				return res.json({
					message: "Order marked delivered and payouts triggered",
					order: updated,
				});
			}

			// Fallback: generic update
			if (status) order.status = status;
			if (riderLocation?.lat && riderLocation?.lng) {
				order.riderLocation = {
					lat: riderLocation.lat,
					lng: riderLocation.lng,
					updatedAt: new Date(),
				};
			}

			await order.save();
			res.json(order);
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	},
);

// View rider's own orders
router.get("/rider", authMiddleware, roleGuard(["rider"]), async (req, res) => {
	try {
		const orders = await Order.find({ rider: req.user.id })
			.populate("user", "name phone")
			.populate("vendor", "name location");
		res.json(orders);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Customer: Get active delivery OTP for an order (in-app only)
router.get(
	"/:id/delivery-otp",
	authMiddleware,
	roleGuard(["customer"]),
	async (req, res) => {
		try {
			const order = await Order.findById(req.params.id);
			if (!order) return res.status(404).json({ error: "Order not found" });
			if (order.customer.toString() !== req.user.id.toString())
				return res.status(403).json({ error: "Not your order" });

			if (!order.deliveryOtpCode || !order.deliveryOtpExpiresAt) {
				return res.status(404).json({ error: "No active OTP for this order" });
			}

			if (new Date() > new Date(order.deliveryOtpExpiresAt)) {
				return res.status(410).json({ error: "OTP expired" });
			}

			// Return OTP in plaintext to customer's app (short-lived)
			return res.json({
				otp: order.deliveryOtpCode,
				expiresAt: order.deliveryOtpExpiresAt,
			});
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	},
);

module.exports = router;
