const orderService = require("../services/order.service");
const { Order } = require("../models");
const logger = require("../utils/logger");
const { paginate } = require("../utils/paginate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

// Create a new order
exports.createOrder = asyncHandler(async (req, res) => {
	const userId = req.user.id;
	const order = await orderService.createOrder(userId, req.body);
	return res.status(201).json({ success: true, order });
});

exports.getMyOrders = asyncHandler(async (req, res) => {
	// We inject the filter { customer: req.user.id } so users only see THEIR orders
	// The original had separate getMyOrders twice, one with pagination one without.
	// The second one (at end of file) was using paginate. I will use that one logic here.
	// But wait, the file I viewed had duplicate exports. createOrder, getMyOrders etc appeared twice.
	// I should probably clean that up too.

	// Let's assume the user wants the pagination one as it was at the bottom.
	const result = await paginate(Order, { ...req.query, customer: req.user.id }, [
		{ path: "vendor", select: "name" },
		{ path: "items.item" },
	]);

	res.status(200).json(result);
});

exports.getOrderById = asyncHandler(async (req, res) => {
	const order = await Order.findById(req.params.id)
		.populate("vendor", "name")
		.populate("items.item")
		.populate("customer");

	if (!order) {
		throw new AppError("Order not found", 404);
	}

	const orderCustomerId = order.customer._id
		? order.customer._id.toString()
		: order.customer.toString();

	if (orderCustomerId !== req.user.id.toString()) {
		throw new AppError("Unauthorized", 403);
	}

	res.status(200).json(order);
});

exports.updateOrderStatus = asyncHandler(async (req, res) => {
	const { id } = req.params;
	const { status, subStatus } = req.body;

	const order = await orderService.updateOrderStatus(id, status, subStatus);
	res.status(200).json({ success: true, order });
});

exports.sendDeliveryOtp = async (order) => {
	return await orderService.sendDeliveryOtp(order);
};

exports.verifyDeliveryOtp = async (order, otp, riderId) => {
	return await orderService.verifyDeliveryOtp(order, otp, riderId);
};

exports.acceptOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const riderId = req.user.id;

	const order = await orderService.acceptOrder(orderId, riderId);

	return res.status(200).json({
		success: true,
		message: "Order accepted successfully",
		order,
	});
});

exports.pickUpOrder = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const riderId = req.user.id;

	const order = await orderService.pickUpOrder(orderId, riderId);

	res.status(200).json({
		success: true,
		message: "Order picked up! OTP sent to customer.",
		order,
	});
});

exports.completeDelivery = asyncHandler(async (req, res) => {
	const { orderId } = req.params;
	const { otp } = req.body;
	const riderId = req.user.id;

	const order = await orderService.completeDelivery(orderId, riderId, otp);

	res.status(200).json({
		success: true,
		message: "Delivery completed successfully!",
		order,
	});
});

exports.getAvailableRiderRequests = asyncHandler(async (req, res) => {
	// Riders only see orders looking for a rider
	const result = await paginate(Order, {
		...req.query,
		subStatus: "LOOKING_FOR_RIDER",
	});
	res.status(200).json(result);
});

exports.getCurrentRiderOrder = asyncHandler(async (req, res) => {
	const riderId = req.user.id;
	const order = await orderService.getCurrentRiderOrder(riderId);

	if (!order) {
		return res
			.status(200)
			.json({ message: "No active ongoing ride", order: null });
	}
	res.status(200).json({ order });
});

exports.getRiderCompletedOrdersToday = asyncHandler(async (req, res) => {
	const riderId = req.user.id;
	const orders = await orderService.getRiderCompletedOrdersToday(riderId);

	res.status(200).json({
		count: orders.length,
		orders,
	});
});
