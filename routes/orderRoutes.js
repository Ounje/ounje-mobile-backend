const express = require("express");
const {
	authMiddleware,
	roleGuard,
	checkActiveUser,
} = require("../middleware/auth");

const {
	requireCustomer,
	requireVendor,
	requireRider,
} = require("../middleware/profile");

const {
	// Customer
	createOrder,
	getMyOrders,
	getOrderById,
	cancelOrder,

	// Vendor
	vendorAcceptOrder,
	vendorDeclineOrder,
	vendorStartPreparing,
	vendorMarkReady,
	getVendorDeclineStats,
	getVendorOrders,
	vendorGetCustomerOrderDetails,

	// Rider
	acceptOrder,
	pickUpOrder,
	resendDeliveryOtp,
	riderMarkOnTheWay,
	completeDelivery,
	getAvailableRiderRequests,
	getCurrentRiderOrder,
	getRiderCompletedOrdersToday,
	getRiderOrders,
	getRiderOrderById,
	reportDelivery,
	updateOrderStatus,
} = require("../controllers/orderController");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Order lifecycle management for Customers, Vendors, and Riders
 */

/* ======================
   CUSTOMER ROUTES
====================== */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Create a new order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, deliveryAddress, items]
 *             properties:
 *               vendorId:
 *                 type: string
 *                 description: ID of the vendor
 *               deliveryAddress:
 *                 type: string
 *                 description: Delivery address
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [itemId, itemType]
 *                   properties:
 *                     itemId:
 *                       type: string
 *                       description: ID of the FoodItem, Combo, or Plate
 *                     itemType:
 *                       type: string
 *                       enum: [FoodItem, Combo, Plate]
 *                     quantity:
 *                       type: number
 *                       default: 1
 *                     notes:
 *                       type: string
 *                       description: Optional instructions for the item
 *                     comboSelections:
 *                       type: array
 *                       description: Required ONLY if itemType is Combo. An array of FoodItem IDs or objects with quantity that the customer selected for the combo options.
 *                       items:
 *                         oneOf:
 *                           - type: string
 *                           - type: object
 *                             properties:
 *                               itemId:
 *                                 type: string
 *                               quantity:
 *                                 type: number
 *                                 default: 1
 *             example:
 *               vendorId: "60f6c2e...etc"
 *               deliveryAddress: "123 Main St"
 *               items:
 *                 - itemId: "60f6c2e...etc"
 *                   itemType: "FoodItem"
 *                   subCategoryItemId: "60f6c2e...etc"
 *                   quantity: 2
 *                 - itemId: "61abc1e...etc"
 *                   itemType: "Combo"
 *                   quantity: 1
 *                   comboSelections: ["62ced4...etc", "62ced5...etc"]
 *     responses:
 *       201:
 *         description: Order created successfully
 *       400:
 *         description: Invalid input or quantity limits exceeded
 *       404:
 *         description: Vendor or items not found
 */
router.post(
	"/",
	authMiddleware,
	checkActiveUser,
	roleGuard(["customer"]),
	requireCustomer,
	createOrder,
);

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
 *         description: List of customer orders
 */
router.get(
	"/",
	authMiddleware,
	checkActiveUser,
	roleGuard(["customer"]),
	requireCustomer,
	getMyOrders,
);

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Get order by ID (customer only)
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
router.get(
	"/:id",
	authMiddleware,
	checkActiveUser,
	roleGuard(["customer"]),
	requireCustomer,
	getOrderById,
);

/**
 * @swagger
 * /api/orders/{orderId}/cancel:
 *   put:
 *     summary: Cancel an order before vendor accepts
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
 *         description: Order cancelled successfully
 *       400:
 *         description: Order cannot be cancelled (e.g. already accepted)
 *       403:
 *         description: Not authorized to cancel this order
 */
router.put(
	"/:orderId/cancel",
	authMiddleware,
	checkActiveUser,
	roleGuard(["customer"]),
	requireCustomer,
	cancelOrder,
);

/* ======================
   VENDOR ROUTES
====================== */

/**
 * @swagger
 * /api/orders/vendor/{orderId}/accept:
 *   put:
 *     summary: Vendor accepts an order
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
 *         description: Order accepted by vendor
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Order not found
 */
router.put(
	"/vendor/:orderId/accept",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	requireVendor,
	vendorAcceptOrder,
);

/**
 * @swagger
 * /api/orders/vendor/{orderId}/decline:
 *   put:
 *     summary: Vendor declines an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 */
router.put(
	"/vendor/:orderId/decline",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	requireVendor,
	vendorDeclineOrder,
);

router.put(
	"/vendor/:orderId/preparing",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	requireVendor,
	vendorStartPreparing,
);

router.put(
	"/vendor/:orderId/ready",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	requireVendor,
	vendorMarkReady,
);

/**
 * @swagger
 * /api/orders/vendor/declines/stats:
 *   get:
 *     summary: Get vendor order decline statistics
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.get(
	"/vendor/declines/stats",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	requireVendor,
	getVendorDeclineStats,
);

/**
 * @swagger
 * /api/orders/vendor/orders:
 *   get:
 *     summary: Get all orders for logged-in vendor
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           description: Optional status filter (active, completed, cancelled, or specific status)
 *     responses:
 *       200:
 *         description: List of vendor orders
 */
router.get(
	"/vendor/orders",
	authMiddleware,
	checkActiveUser,
	roleGuard(["vendor"]),
	requireVendor,
	getVendorOrders,
);
/**
 * @swagger
 * /api/orders/vendor/order/{orderId}:
 *   get:
 *     summary: Get a specific order details (vendor only)
 *     description: >
 *       Allows a vendor to view the full details of a specific order placed at their restaurant.
 *       Returns customer name, ordered items with names and prices, delivery fee, and order status.
 *       Vendors can only view orders that belong to their own restaurant.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the order to retrieve
 *     responses:
 *       200:
 *         description: Order details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 order:
 *                   type: object
 *                   properties:
 *                     customerName:
 *                       type: string
 *                       example: "John Doe"
 *                     totalAmount:
 *                       type: number
 *                       example: 5000
 *                     deliveryFee:
 *                       type: number
 *                       example: 500
 *                     grandTotal:
 *                       type: number
 *                       example: 5500
 *                     status:
 *                       type: string
 *                       example: "delivered"
 *                     subStatus:
 *                       type: string
 *                       example: "delivered"
 *                     deliveryAddress:
 *                       type: string
 *                       example: "123 street"
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           itemType:
 *                             type: string
 *                             example: "FoodItem"
 *                           itemName:
 *                             type: string
 *                             example: "Goat Meat"
 *                           quantity:
 *                             type: number
 *                             example: 2
 *                           price:
 *                             type: number
 *                             example: 700
 *                           totalPrice:
 *                             type: number
 *                             example: 1400
 *                           notes:
 *                             type: string
 *                             example: "extra spicy"
 *       403:
 *         description: Unauthorized - order does not belong to this vendor
 *       404:
 *         description: Order not found
 *       500:
 *         description: Server error
 */
router.get(
	"/vendor/order/:orderId",
	authMiddleware,
	roleGuard(["vendor"]),
	requireVendor,
	checkActiveUser,
	vendorGetCustomerOrderDetails,
);

/* ======================
   RIDER DASHBOARD ROUTES
====================== */

/**
 * @swagger
 * /api/orders/rider/requests:
 *   get:
 *     summary: Get available delivery requests
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.get(
	"/rider/requests",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	getAvailableRiderRequests,
);

/**
 * @swagger
 * /api/orders/rider/ongoing:
 *   get:
 *     summary: Get rider's current active order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.get(
	"/rider/ongoing",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	getCurrentRiderOrder,
);

/**
 * @swagger
 * /api/orders/rider/completed-today:
 *   get:
 *     summary: Get rider completed orders today
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.get(
	"/rider/completed-today",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	getRiderCompletedOrdersToday,
);

/**
 * @swagger
 * /api/orders/rider/orders:
 *   get:
 *     summary: Get rider orders with status filter
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, completed]
 */
router.get(
	"/rider/orders",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	getRiderOrders,
);

/**
 * @swagger
 * /api/orders/rider/{orderId}:
 *   get:
 *     summary: Get a single order by ID for rider
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */

/* ======================
   RIDER ACTION ROUTES
====================== */

router.get(
	"/rider/:orderId",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	getRiderOrderById,
);

router.post(
    "/rider/:orderId/resend-otp",
    authMiddleware,
    checkActiveUser,
    roleGuard(["rider"]),
    resendDeliveryOtp,
);
/**
 * @swagger
 * /api/orders/rider/{orderId}/accept:
 *   put:
 *     summary: Rider accepts an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.put(
	"/rider/:orderId/accept",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	acceptOrder,
);

/**
 * @swagger
 * /api/orders/rider/{orderId}/pickup:
 *   put:
 *     summary: Rider picks up order (OTP is sent to customer via socket)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.put(
	"/rider/:orderId/pickup",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	pickUpOrder,
);

/**
 * @swagger
 * /api/orders/rider/{orderId}/complete:
 *   put:
 *     summary: Rider completes delivery using OTP
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otp]
 */
router.put(
	"/rider/:orderId/on-the-way",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	riderMarkOnTheWay,
);

router.put(
	"/rider/:orderId/complete",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	completeDelivery,
);

/**
 * @swagger
 * /api/orders/rider/{orderId}/report:
 *   post:
 *     summary: Rider reports a delivery issue
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
 *             required: [note]
 *             properties:
 *               note:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Description of the issue
 *     responses:
 *       200:
 *         description: Report submitted successfully
 *       400:
 *         description: Note is required or already reported
 *       403:
 *         description: Not the assigned rider
 *       404:
 *         description: Order not found
 */
router.post(
	"/rider/:orderId/report",
	authMiddleware,
	checkActiveUser,
	roleGuard(["rider"]),
	requireRider,
	reportDelivery,
);

/**
 * @swagger
 * /api/orders/{id}/status:
 *   put:
 *     summary: Update order status
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 */
router.put(
	"/:id/status",
	authMiddleware,
	roleGuard(["customer"]),
	updateOrderStatus,
);

module.exports = router;