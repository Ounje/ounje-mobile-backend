const orderService = require("../services/order.service");
const { Order } = require("../models");
const logger = require("../utils/logger");
const { paginate } = require("../utils/paginate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

// Helper: Standardize Rider Order Response
const formatRiderOrder = (order) => {
	if (!order) return null;
	const orderObj = order.toObject ? order.toObject() : order;
	return {
		...orderObj,
		id: orderObj._id,
		amount: orderObj.totalPrice,
		vendor: orderObj.vendor
			? {
				id: orderObj.vendor._id || orderObj.vendor,
				name: orderObj.vendor.name || "Unknown Vendor",
				address: orderObj.vendor.address || "",
				phone: orderObj.vendor.phone || "",
				location: orderObj.vendor.location || null,
			}
			: null,
	};
};

// Create Order
exports.createOrder = asyncHandler(async (req, res) => {
	const userId = req.user.id;
	const order = await orderService.createOrder(userId, req.body);

	logger.info(`Order created: ${order._id} by user ${userId}`);
	res.status(201).json({ success: true, order });
});

// Cancel Order (customer)
exports.cancelOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const customerId = req.user.id;

	const order = await orderService.cancelOrder(orderId, customerId);
	res.status(200).json({
		success: true,
		message: "Order cancelled successfully",
		order,
	});
});

// Get my orders
exports.getMyOrders = asyncHandler(async (req, res) => {
	const result = await paginate(
		Order,
		req.query,
		[{ path: "vendor", select: "name" }, { path: "items.item" }],
		{ customer: req.user.id },
	);

	res.status(200).json(result);
});

// Get single order (customer only)
exports.getOrderById = asyncHandler(async (req, res) => {
	const order = await Order.findById(req.params.id)
		.populate("vendor", "name")
		.populate("items.item")
		.populate("customer");

	if (!order) throw new AppError("Order not found", 404);

	if (order.customer._id.toString() !== req.user.id.toString()) {
		throw new AppError("Unauthorized", 403);
	}

	res.status(200).json(order);
});

// Vendor accepts order
exports.vendorAcceptOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const vendorId = req.user.id;

	const order = await orderService.vendorAcceptOrder(orderId, vendorId);
	res.status(200).json({
		success: true,
		message: "Order accepted successfully",
		order,
	});
});

// Vendor declines order
exports.vendorDeclineOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const vendorId = req.user.id;

	const order = await orderService.declineOrder(orderId, vendorId, req.body);

	res.status(200).json({
		success: true,
		message: "Order declined successfully",
		order,
	});
});

// Vendor decline statistics
exports.getVendorDeclineStats = asyncHandler(async (req, res) => {
	const vendorId = req.user.id;
	const stats = await orderService.getDeclineStats(vendorId, req.query);
	res.status(200).json(stats);
});

// Rider accepts order
exports.acceptOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const riderId = req.user.id;

	const order = await orderService.acceptOrder(orderId, riderId);
	res.status(200).json({
		success: true,
		message: "Order accepted",
		order: formatRiderOrder(order),
	});
});

// Rider declines assigned order
exports.riderDeclineOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const riderId = req.user.id;

	const order = await orderService.riderDeclineOrder(
		orderId,
		riderId,
		req.body,
	);

	res.status(200).json({
		success: true,
		message: "Order declined successfully",
		order: formatRiderOrder(order),
	});
});

// Rider picks up order
exports.pickUpOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const riderId = req.user.id;

	const order = await orderService.pickUpOrder(orderId, riderId);
	res.status(200).json({
		success: true,
		message: "Order picked up. OTP sent to customer.",
		order: formatRiderOrder(order),
	});
});

// Rider completes delivery
exports.completeDelivery = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const { otp } = req.body;
	const riderId = req.user.id;

	const order = await orderService.completeDelivery(orderId, riderId, otp);
	res.status(200).json({
		success: true,
		message: "Delivery completed successfully",
		order: formatRiderOrder(order),
	});
});

// Get available rider requests
exports.getAvailableRiderRequests = asyncHandler(async (req, res) => {
	const orders = await orderService.getAvailableRiderRequests();
	res.status(200).json({
		count: orders.length,
		orders: orders.map(formatRiderOrder),
	});
});

// Get current active rider order
exports.getCurrentRiderOrder = asyncHandler(async (req, res) => {
	const riderId = req.user.id;
	const order = await orderService.getCurrentRiderOrder(riderId);

	res.status(200).json({
		order: formatRiderOrder(order),
		message: order ? undefined : "No active order",
	});
});

// Rider completed orders today
exports.getRiderCompletedOrdersToday = asyncHandler(async (req, res) => {
	const orders = await orderService.getRiderCompletedOrdersToday(req.user.id);
	res.status(200).json({
		count: orders.length,
		orders: orders.map(formatRiderOrder),
	});
});

// Rider order history with filters
exports.getRiderOrders = asyncHandler(async (req, res) => {
	const riderId = req.user.id;
	const { status } = req.query;

	const orders = await orderService.getRiderOrders(riderId, status);
	res.status(200).json({ count: orders.length, orders: orders.map(formatRiderOrder) });
});

exports.updateOrderStatus = asyncHandler(async (req, res) => {
	const { id } = req.params;
	const { status, subStatus } = req.body;

	const order = await orderService.updateOrderStatus(id, status, subStatus);
	res.status(200).json({ success: true, order });
});

// Get orders for logged-in vendor
exports.getVendorOrders = asyncHandler(async (req, res) => {
	const orders = await orderService.getVendorOrders(req.user.id, req.query);
	res.status(200).json({ count: orders.length, orders });
});
