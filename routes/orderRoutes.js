const express = require("express");
const {
	authMiddleware,
	roleGuard,
	checkActiveUser,
} = require("../middleware/auth");
const { Order, RiderProfile } = require("../models");

const {
	createOrder,
	getMyOrders,
	getOrderById,
	updateOrderStatus,
	sendDeliveryOtp,
	verifyDeliveryOtp,
	acceptOrder,
	pickUpOrder,
	getRiderOrders,
	completeDelivery,
	getAvailableRiderRequests,
	getCurrentRiderOrder,
	getRiderCompletedOrdersToday,
} = require("../controllers/orderController");

const router = express.Router();

/* ======================
   CUSTOMER ROUTES
====================== */

// Create new order (customer)
/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order Management for Customers, Vendors, and Riders
 */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Create a new order (Customer)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vendorId
 *               - deliveryAddress
 *               - items
 *             properties:
 *               vendorId:
 *                 type: string
 *               deliveryAddress:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     itemId:
 *                       type: string
 *                     itemType:
 *                       type: string
 *                       enum: [FoodItem, Dish, Plate]
 *                     quantity:
 *                       type: integer
 *                     notes:
 *                       type: string
 *     responses:
 *       201:
 *         description: Order created
 *       400:
 *         description: Validation error
 */
router.post("/", authMiddleware, roleGuard(["customer"]), createOrder);

// Get all orders of logged-in customer
/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Get all orders for logged-in customer
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of orders
 */
router.get("/", authMiddleware, roleGuard(["customer"]), getMyOrders);

/* ======================
   SELLER ROUTES
====================== */

// View orders for logged-in vendor
/**
 * @swagger
 * /api/orders/vendor:
 *   get:
 *     summary: Get all orders for logged-in vendor
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of vendor orders
 */
router.get(
	"/vendor",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	async (req, res) => {
		try {
			const orders = await Order.find({ vendor: req.user.id })
				.populate("customer", "name phone")
				.populate("items.item");
			res.json(orders);
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	},
);

// Get a specific order by ID (customer)
/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Get order by ID (Customer)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order details
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Order not found
 */
router.get("/:id", authMiddleware, roleGuard(["customer"]), getOrderById);

// Update order status (e.g., cancel) (customer)
/**
 * @swagger
 * /api/orders/{id}:
 *   put:
 *     summary: Update order status (Customer - e.g. Cancel)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order updated
 */
router.put("/:id", authMiddleware, roleGuard(["customer"]), updateOrderStatus);

// Update order status (confirm/cancel) (seller)
/**
 * @swagger
 * /api/orders/{id}/status:
 *   put:
 *     summary: Update order status (Vendor - Confirm/Cancel)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [confirmed, cancelled]
 *     responses:
 *       200:
 *         description: Order status updated
 *       403:
 *         description: Unauthorized
 */
router.put(
	"/:id/status",
	authMiddleware,
	checkActiveUser,
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
   RIDER DASHBOARD ROUTES
====================== */

// 1. Get New Delivery Requests
router.get(
	"/rider/requests",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	getAvailableRiderRequests,
);

// 2. Get Ongoing Ride
router.get(
	"/rider/ongoing",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	getCurrentRiderOrder,
);

// 3. Get Completed Rides Today
router.get(
	"/rider/completed-today",
	authMiddleware,
	roleGuard(["rider"]),
	checkActiveUser,
	getRiderCompletedOrdersToday,
);

/* ======================
   RIDER ROUTES
====================== */

// View available orders (confirmed, unassigned)
/**
 * @swagger
 * /api/orders/available:
 *   get:
 *     summary: Get available orders for rider (match zone)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available orders
 */
router.get(
	"/available",
	authMiddleware,
	roleGuard(["rider"]),
	checkActiveUser,

	async (req, res) => {
		try {
			// Get the rider's operating areas (Max 2 zones)
			const rider = await RiderProfile.findById(req.user.id);

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
/**
 * @swagger
 * /api/orders/accept/{orderId}:
 *   put:
 *     summary: Rider accepts an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order accepted
 *       400:
 *         description: Order no longer available
 */
router.put(
	"/accept/:orderId",
	authMiddleware,
	roleGuard(["rider"]),
	checkActiveUser,
	acceptOrder,
);

// Update order status and optionally rider location
// router.put(
// 	"/:id/rider-update",
// 	authMiddleware,
// 	roleGuard(["rider"]),
// 	async (req, res) => {
// 		try {
// 			const { status, riderLocation, otp } = req.body;
// 			const order = await Order.findById(req.params.id);
// 			if (!order) return res.status(404).json({ error: "Order not found" });
// 			if (!order.rider || !order.rider.equals(req.user.id))
// 				return res.status(403).json({ error: "Not assigned to you" });

// 			if (status && !["out_for_delivery", "delivered"].includes(status))
// 				return res.status(400).json({ error: "Invalid rider status" });

// When rider picks up (out_for_delivery) -> send OTP to customer
// if (status === "out_for_delivery") {
// 	order.status = status;
// 	if (riderLocation?.lat && riderLocation?.lng) {
// 		order.riderLocation = {
// 			lat: riderLocation.lat,
// 			lng: riderLocation.lng,
// 			updatedAt: new Date(),
// 		};
// 	}
// 	await order.save();

// 	try {
// 		await sendDeliveryOtp(order);
// 	} catch (e) {
// 		console.error("Failed to send delivery OTP:", e.message);
// 	}

// 	return res.json({
// 		message: "OTP sent to customer and order updated",
// 		order,
// 	});
// }

// When delivered -> verify OTP (required) then complete order and trigger payouts
// if (status === "delivered") {
// 	if (!otp)
// 		return res
// 			.status(400)
// 			.json({ error: "OTP required to confirm delivery" });

// 	const verified = await verifyDeliveryOtp(order, otp, req.user.id);
// 	if (!verified.success) {
// 		return res.status(400).json({ error: "Invalid OTP" });
// 	}

// Refresh order after verification
// 	const updated = await Order.findById(req.params.id);
// 	return res.json({
// 		message: "Order marked delivered and payouts triggered",
// 		order: updated,
// 	});
// }

// Fallback: generic update
// 			if (status) order.status = status;
// 			if (riderLocation?.lat && riderLocation?.lng) {
// 				order.riderLocation = {
// 					lat: riderLocation.lat,
// 					lng: riderLocation.lng,
// 					updatedAt: new Date(),
// 				};
// 			}

// 			await order.save();
// 			res.json(order);
// 		} catch (err) {
// 			res.status(500).json({ error: err.message });
// 		}
// 	},
// );

// Rider marks order as picked up from Vendor
/**
 * @swagger
 * /api/orders/pickup/{orderId}:
 *   put:
 *     summary: Rider marks order as picked up
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order picked up, OTP sent to customer
 *       403:
 *         description: Not assigned rider
 */
router.put(
	"/pickup/:orderId",
	authMiddleware,
	roleGuard(["rider"]),
	checkActiveUser,
	pickUpOrder,
);

// Rider completes the delivery using the Customer's OTP
/**
 * @swagger
 * /api/orders/complete/{orderId}:
 *   put:
 *     summary: Rider completes delivery (Verifies OTP)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - otp
 *             properties:
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Delivery completed
 *       400:
 *         description: Invalid OTP
 */
router.put(
	"/complete/:orderId",
	authMiddleware,
	roleGuard(["rider"]),
	checkActiveUser,
	completeDelivery,
);

// View rider's own orders
/**
 * @swagger
 * /api/orders/rider:
 *   get:
 *     summary: Get all orders assigned to logged-in rider
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of rider orders
 */
router.get("/rider", authMiddleware, roleGuard(["rider"]), async (req, res) => {
	try {
		const orders = await Order.find({ rider: req.user.id })
			.populate("customer", "name phone")
			.populate("vendor", "name location");
		res.json(orders);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// Customer: Get active delivery OTP for an order (in-app only)
/**
 * @swagger
 * /api/orders/{id}/delivery-otp:
 *   get:
 *     summary: Get delivery OTP for an order (Customer)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Returns OTP
 *       404:
 *         description: No active OTP
 *       410:
 *         description: OTP expired
 */
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

router.get(
	"/rider",
	authMiddleware,
	roleGuard(["rider"]),
	checkActiveUser,
	getRiderOrders,
);

module.exports = router;
