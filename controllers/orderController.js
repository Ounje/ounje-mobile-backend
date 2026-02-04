const orderService = require("../services/order.service");
const Order = require("../models/Order");
const logger = require("../utilis/logger");
const { paginate } = require("../utilis/paginate");

// Create a new order
exports.createOrder = async (req, res) => {
	try {
		const userId = req.user.id;
		const order = await orderService.createOrder(userId, req.body);
		return res.status(201).json({ success: true, order });
	} catch (error) {
		logger.error(`CRITICAL ERROR: ${error.message}`);
		return res
			.status(500)
			.json({ message: "Order failed", error: error.message });
	}
};

exports.getMyOrders = async (req, res) => {
	try {
		const orders = await Order.find({ customer: req.user.id })
			.populate("vendor", "name")
			.populate("items.item");

		res.status(200).json(orders);
	} catch (error) {
		logger.error(`GET_MY_ORDERS_ERROR: ${error.message}`);
		res
			.status(500)
			.json({ message: "Error fetching orders", error: error.message });
	}
};

exports.getOrderById = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id)
			.populate("vendor", "name")
			.populate("items.item")
			.populate("customer");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		const orderCustomerId = order.customer._id
			? order.customer._id.toString()
			: order.customer.toString();

		if (orderCustomerId !== req.user.id.toString()) {
			return res.status(403).json({ message: "Unauthorized" });
		}

		res.status(200).json(order);
	} catch (error) {
		logger.error(`GET_ORDER_BY_ID_ERROR: ${error.message}`);
		res
			.status(500)
			.json({ message: "Error fetching order", error: error.message });
	}
};

exports.updateOrderStatus = async (req, res) => {
	try {
		const { id } = req.params;
		const { status, subStatus } = req.body;

		const order = await orderService.updateOrderStatus(id, status, subStatus);
		res.status(200).json({ success: true, order });
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to update order", error: error.message });
	}
};

exports.sendDeliveryOtp = async (order) => {
	// This is now just a wrapper or direct call,
	// but the routes might call the controller functions.
	// However, sendDeliveryOtp WAS exported and used internally.
	// It's safer to defer to the service.
	try {
		return await orderService.sendDeliveryOtp(order);
	} catch (err) {
		throw err;
	}
};

exports.verifyDeliveryOtp = async (order, otp, riderId) => {
	try {
		return await orderService.verifyDeliveryOtp(order, otp, riderId);
	} catch (err) {
		throw err;
	}
};

exports.acceptOrder = async (req, res) => {
	try {
		const { orderId } = req.params;
		const riderId = req.user.id;

		const order = await orderService.acceptOrder(orderId, riderId);

		return res.status(200).json({
			success: true,
			message: "Order accepted successfully",
			order,
		});
	} catch (error) {
		logger.error(`ACCEPT_ORDER_ERROR: ${error.message}`);
		return res
			.status(500)
			.json({
				success: false,
				message: "Failed to accept order",
				error: error.message,
			});
	}
};

exports.pickUpOrder = async (req, res) => {
	try {
		const { orderId } = req.params;
		const riderId = req.user.id;

		const order = await orderService.pickUpOrder(orderId, riderId);

		res.status(200).json({
			success: true,
			message: "Order picked up! OTP sent to customer.",
			order,
		});
	} catch (error) {
		res.status(500).json({ message: "Pickup failed", error: error.message });
	}
};

exports.completeDelivery = async (req, res) => {
	try {
		const { orderId } = req.params;
		const { otp } = req.body;
		const riderId = req.user.id;

		const order = await orderService.completeDelivery(orderId, riderId, otp);

		res.status(200).json({
			success: true,
			message: "Delivery completed successfully!",
			order,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Delivery completion failed", error: error.message });
	}
};

exports.getAvailableRiderRequests = async (req, res) => {
	try {
		const orders = await orderService.getAvailableRiderRequests();
		res.status(200).json(orders);
	} catch (error) {
		logger.error(`GET_RIDER_REQUESTS_ERROR: ${error.message}`);
		res
			.status(500)
			.json({ message: "Error fetching rider requests", error: error.message });
	}
};

exports.getCurrentRiderOrder = async (req, res) => {
	try {
		const riderId = req.user.id;
		const order = await orderService.getCurrentRiderOrder(riderId);

		if (!order) {
			return res
				.status(200)
				.json({ message: "No active ongoing ride", order: null });
		}
		res.status(200).json({ order });
	} catch (error) {
		logger.error(`GET_CURRENT_RIDER_ORDER_ERROR: ${error.message}`);
		res
			.status(500)
			.json({ message: "Error fetching ongoing order", error: error.message });
	}
};

exports.getRiderCompletedOrdersToday = async (req, res) => {
	try {
		const riderId = req.user.id;
		const orders = await orderService.getRiderCompletedOrdersToday(riderId);

		res.status(200).json({
			count: orders.length,
			orders,
		});
	} catch (error) {
		logger.error(`GET_RIDER_COMPLETED_TODAY_ERROR: ${error.message}`);
		res
			.status(500)
			.json({
				message: "Error fetching completed orders",
				error: error.message,
			});
	}
};

// Create a new order
exports.createOrder = async (req, res) => {
	try {
		const userId = req.user.id;
		const order = await orderService.createOrder(userId, req.body);
		return res.status(201).json({ success: true, order });
	} catch (error) {
		console.error("CRITICAL ERROR:", error);
		return res
			.status(500)
			.json({ message: "Order failed", error: error.message });
	}
};

exports.getMyOrders = async (req, res) => {
	try {
		const orders = await Order.find({ customer: req.user.id })
			.populate("vendor", "name")
			.populate("items.item");

		res.status(200).json(orders);
	} catch (error) {
		console.error("GET_MY_ORDERS_ERROR:", error);
		res
			.status(500)
			.json({ message: "Error fetching orders", error: error.message });
	}
};

exports.getOrderById = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id)
			.populate("vendor", "name")
			.populate("items.item")
			.populate("customer");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		const orderCustomerId = order.customer._id
			? order.customer._id.toString()
			: order.customer.toString();

		if (orderCustomerId !== req.user.id.toString()) {
			return res.status(403).json({ message: "Unauthorized" });
		}

		res.status(200).json(order);
	} catch (error) {
		console.error("GET_ORDER_BY_ID_ERROR:", error);
		res
			.status(500)
			.json({ message: "Error fetching order", error: error.message });
	}
};

exports.updateOrderStatus = async (req, res) => {
	try {
		const { id } = req.params;
		const { status, subStatus } = req.body;

		const order = await orderService.updateOrderStatus(id, status, subStatus);
		res.status(200).json({ success: true, order });
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to update order", error: error.message });
	}
};

exports.sendDeliveryOtp = async (order) => {
	// This is now just a wrapper or direct call,
	// but the routes might call the controller functions.
	// However, sendDeliveryOtp WAS exported and used internally.
	// It's safer to defer to the service.
	try {
		return await orderService.sendDeliveryOtp(order);
	} catch (err) {
		throw err;
	}
};

exports.verifyDeliveryOtp = async (order, otp, riderId) => {
	try {
		return await orderService.verifyDeliveryOtp(order, otp, riderId);
	} catch (err) {
		throw err;
	}
};

exports.acceptOrder = async (req, res) => {
	try {
		const { orderId } = req.params;
		const riderId = req.user.id;

		const order = await orderService.acceptOrder(orderId, riderId);

		return res.status(200).json({
			success: true,
			message: "Order accepted successfully",
			order,
		});
	} catch (error) {
		console.error("ACCEPT_ORDER_ERROR:", error);
		return res
			.status(500)
			.json({
				success: false,
				message: "Failed to accept order",
				error: error.message,
			});
	}
};

exports.pickUpOrder = async (req, res) => {
	try {
		const { orderId } = req.params;
		const riderId = req.user.id;

		const order = await orderService.pickUpOrder(orderId, riderId);

		res.status(200).json({
			success: true,
			message: "Order picked up! OTP sent to customer.",
			order,
		});
	} catch (error) {
		res.status(500).json({ message: "Pickup failed", error: error.message });
	}
};

exports.completeDelivery = async (req, res) => {
	try {
		const { orderId } = req.params;
		const { otp } = req.body;
		const riderId = req.user.id;

		const order = await orderService.completeDelivery(orderId, riderId, otp);

		res.status(200).json({
			success: true,
			message: "Delivery completed successfully!",
			order,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Delivery completion failed", error: error.message });
	}
};

exports.getAvailableRiderRequests = async (req, res) => {
	try {
		const orders = await orderService.getAvailableRiderRequests();
		res.status(200).json(orders);
	} catch (error) {
		console.error("GET_RIDER_REQUESTS_ERROR:", error);
		res
			.status(500)
			.json({ message: "Error fetching rider requests", error: error.message });
	}
};

exports.getCurrentRiderOrder = async (req, res) => {
	try {
		const riderId = req.user.id;
		const order = await orderService.getCurrentRiderOrder(riderId);

		if (!order) {
			return res
				.status(200)
				.json({ message: "No active ongoing ride", order: null });
		}
		res.status(200).json({ order });
	} catch (error) {
		console.error("GET_CURRENT_RIDER_ORDER_ERROR:", error);
		res
			.status(500)
			.json({ message: "Error fetching ongoing order", error: error.message });
	}
};

exports.getRiderCompletedOrdersToday = async (req, res) => {
	try {
		const riderId = req.user.id;
		const orders = await orderService.getRiderCompletedOrdersToday(riderId);

		res.status(200).json({
			count: orders.length,
			orders,
		});
	} catch (error) {
		console.error("GET_RIDER_COMPLETED_TODAY_ERROR:", error);
		res
			.status(500)
			.json({
				message: "Error fetching completed orders",
				error: error.message,
			});
	}
};

exports.getMyOrders = async (req, res) => {
	try {
		// We inject the filter { customer: req.user.id } so users only see THEIR orders
		const result = await paginate(Order, { ...req.query, customer: req.user.id }, [
			{ path: "vendor", select: "name" },
			{ path: "items.item" }
		]);

		res.status(200).json(result);
	} catch (error) {
		logger.error(`GET_MY_ORDERS_ERROR: ${error.message}`);
		res.status(500).json({ message: "Error fetching orders", error: error.message });
	}
};

exports.getAvailableRiderRequests = async (req, res) => {
	try {
		// Riders only see orders looking for a rider
		const result = await paginate(Order, { ...req.query, subStatus: "LOOKING_FOR_RIDER" });
		res.status(200).json(result);
	} catch (error) {
		logger.error(`GET_RIDER_REQUESTS_ERROR: ${error.message}`);
		res.status(500).json({ message: "Error fetching rider requests", error: error.message });
	}
};