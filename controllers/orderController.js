const orderService = require("../services/order.service");
const orderVendorService = require("../services/order.vendor.service");
const orderRiderService = require("../services/order.rider.service");
const { Order, Customer } = require("../models");
const logger = require("../utils/logger");
const { paginate } = require("../utils/paginate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

const cleanOrderItems = (items) => {
	if (items && Array.isArray(items)) {
		items.forEach((item) => {
			if (item.itemType !== "Combo" && item.comboSelections && item.comboSelections.length === 0) {
				delete item.comboSelections;
			}
		});
	}
};

// Helper: Standardize Rider Order Response
const formatRiderOrder = (order) => {
	if (!order) return null;
	const orderObj = order.toObject ? order.toObject() : order;

	cleanOrderItems(orderObj.items);

	return {
		...orderObj,
		id: orderObj._id,
		amount: orderObj.totalPrice, // Map totalPrice to amount
		vendor: orderObj.vendor
			? {
				id: orderObj.vendor._id || orderObj.vendor,
				name: orderObj.vendor.name || "Unknown Vendor",
			}
			: null,
	};
};

// Create Order
exports.createOrder = asyncHandler(async (req, res) => {
	const userId = req.user.id;
	const order = await orderService.createOrder(userId, req.body);

	logger.info(`Order created: ${order._id} by user ${userId}`);
	const orderObj = order.toObject();

	cleanOrderItems(orderObj.items);

	res.status(201).json({ success: true, order: orderObj });
});

// Cancel Order (customer)
exports.cancelOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;

	const order = await orderService.cancelOrder(orderId, req.customer._id.toString());
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
		{ customer: req.customer._id },
	);

	if (result.data && Array.isArray(result.data)) {
		result.data = result.data.map(orderDoc => {
			const orderObj = orderDoc.toObject ? orderDoc.toObject() : orderDoc;
			cleanOrderItems(orderObj.items);
			return orderObj;
		});
	}

	res.status(200).json(result);
});

// Get single order (customer only)
exports.getOrderById = asyncHandler(async (req, res) => {
	const order = await Order.findById(req.params.id)
		.populate("vendor", "name")
		.populate("items.item")
		.populate("customer");

	if (!order) throw new AppError("Order not found", 404);

	if (order.customer._id.toString() !== req.customer._id.toString()) {
		throw new AppError("Unauthorized", 403);
	}

	const orderObj = order.toObject();

	cleanOrderItems(orderObj.items);

	res.status(200).json({ success: true, order: orderObj });
});

// Vendor accepts order
exports.vendorAcceptOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const vendorId = req.vendor._id;

	const order = await orderVendorService.vendorAcceptOrder(orderId, vendorId.toString());
	res.status(200).json({
		success: true,
		message: "Order accepted successfully",
		order,
	});
});

// Vendor declines order
exports.vendorDeclineOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const vendorId = req.vendor._id;

	const order = await orderVendorService.declineOrder(orderId, vendorId.toString(), req.body);

	res.status(200).json({
		success: true,
		message: "Order declined successfully",
		order,
	});
});

// Vendor decline statistics
exports.getVendorDeclineStats = asyncHandler(async (req, res) => {
	const vendorId = req.vendor._id;
	const stats = await orderVendorService.getDeclineStats(vendorId.toString(), req.query);
	res.status(200).json(stats);
});

// Rider accepts order
exports.acceptOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const riderId = req.rider._id;

	const order = await orderService.acceptOrder(orderId, riderId.toString());
	res.status(200).json({
		success: true,
		message: "Order accepted",
		order: formatRiderOrder(order),
	});
});

// Rider declines assigned order
exports.riderDeclineOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const riderId = req.rider._id;

	const order = await orderRiderService.riderDeclineOrder(
		orderId,
		riderId.toString(),
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
	const riderId = req.rider._id;

	const order = await orderService.pickUpOrder(orderId, riderId.toString());
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
	const riderId = req.rider._id;

	const order = await orderService.completeDelivery(orderId, riderId.toString(), otp);
	res.status(200).json({
		success: true,
		message: "Delivery completed successfully",
		order: formatRiderOrder(order),
	});
});

// Get available rider requests
exports.getAvailableRiderRequests = asyncHandler(async (req, res) => {
	const orders = await orderRiderService.getAvailableRiderRequests();
	res.status(200).json({
		count: orders.length,
		orders: orders.map(formatRiderOrder),
	});
});

// Get current active rider order
exports.getCurrentRiderOrder = asyncHandler(async (req, res) => {
	const riderId = req.rider._id;
	const order = await orderRiderService.getCurrentRiderOrder(riderId.toString());

	res.status(200).json({
		order: formatRiderOrder(order),
		message: order ? undefined : "No active order",
	});
});

// Rider completed orders today
exports.getRiderCompletedOrdersToday = asyncHandler(async (req, res) => {
	const orders = await orderRiderService.getRiderCompletedOrdersToday(req.rider._id.toString());
	res.status(200).json({
		count: orders.length,
		orders: orders.map(formatRiderOrder),
	});
});

// Rider order history with filters
exports.getRiderOrders = asyncHandler(async (req, res) => {
	const riderId = req.rider._id;
	const { status } = req.query;

	const orders = await orderRiderService.getRiderOrders(riderId.toString(), status);
	res
		.status(200)
		.json({ count: orders.length, orders: orders.map(formatRiderOrder) });
});

exports.updateOrderStatus = asyncHandler(async (req, res) => {
	const { id } = req.params;
	const { status, subStatus } = req.body;

	const order = await orderService.updateOrderStatus(id, status, subStatus);
	res.status(200).json({ success: true, order });
});

// Get orders for logged-in vendor
exports.getVendorOrders = asyncHandler(async (req, res) => {
	const orders = await orderVendorService.getVendorOrders(req.vendor._id.toString(), req.query);

	const cleanedOrders = orders.map(orderDoc => {
		const orderObj = orderDoc.toObject ? orderDoc.toObject() : orderDoc;
		cleanOrderItems(orderObj.items);
		return orderObj;
	});

	res.status(200).json({ count: cleanedOrders.length, orders: cleanedOrders });
});

// Get single order for vendor
exports.vendorGetCustomerOrderDetails = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const vendorId = req.vendor._id;

	const order = await orderVendorService.vendorGetCustomerOrderDetails(
		orderId,
		vendorId.toString(),
	);
	res.status(200).json({ success: true, order });
});
