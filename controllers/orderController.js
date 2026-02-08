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
	logger.info(`Order created: ${order._id} by User ${userId}`);
	return res.status(201).json({ success: true, order });
});

exports.getMyOrders = asyncHandler(async (req, res) => {
	const result = await paginate(
		Order,
		{ ...req.query, customer: req.user.id },
		[{ path: "vendor", select: "name" }, { path: "items.item" }],
	);
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

/**
 * Get rider's orders with filtering
 * Query params:
 *   - status: pending | active | completed
 *   - page: number
 *   - limit: number
 */
exports.getRiderOrders = asyncHandler(async (req, res) => {
	const riderId = req.user.id;
	const { status } = req.query;

	// Build filter based on status query
	const filter = { rider: riderId };

	if (status === "pending") {
		// Orders available for pickup (rider assigned but not picked up yet)
		filter.status = "RIDING";
		filter.subStatus = "RIDER_ASSIGNED";
	} else if (status === "active") {
		// Orders currently being delivered (picked up but not delivered)
		filter.status = "RIDING";
		filter.subStatus = "PICKED_UP";
	} else if (status === "completed") {
		// Delivered orders
		filter.status = "DELIVERED";
		filter.subStatus = "DELIVERED";
	}

	const result = await paginate(
		Order,
		{ ...req.query, ...filter },
		[
			{ path: "vendor", select: "name" },
			{ path: "customer", select: "name" },
		],

		{
			select:
				"totalPrice status subStatus deliveryFee deliveryConfirmedAt updatedAt createdAt",
		},
	);

	const transformedData = {
		...result,
		data: result.data.map((order) => ({
			id: order._id,
			vendor: order.vendor ? { name: order.vendor.name } : null,
			customer: order.customer ? { name: order.customer.name } : null,
			amount: order.totalPrice,
			status: order.status,
			subStatus: order.subStatus,
			completedAt: order.deliveryConfirmedAt || null,
			updatedAt: order.updatedAt,
			createdAt: order.createdAt,
		})),
	};

	res.status(200).json(transformedData);
});
