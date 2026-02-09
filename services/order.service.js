const {
	Order,
	VendorProfile,
	Combo,
	FoodItem,
	Plate,
	Customer,
	RiderProfile,
} = require("../models");
const { calculateOunjeFee, identifyZone } = require("../utils/delivery");
const crypto = require("crypto");
const { sendPushNotification } = require("./push.notification.service");
const ledgerService = require("./ledger.service");
const notificationService = require("./notification.service");
const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utils/constants");
const logger = require("../utils/logger");
const mongoose = require("mongoose");

// --- Helpers ---

const generateNumericOtp = (length = 6) => {
	let otp = "";
	for (let i = 0; i < length; i++) otp += crypto.randomInt(0, 10).toString();
	return otp;
};

const hashOtp = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

const findNearbyRiders = async (vendorLocation, orderId) => {
	try {
		// 1. Find all available riders within 3km (3000 meters)
		const nearbyRiders = await RiderProfile.find({
			status: "available",
			isActive: true,
			currentLocation: {
				$near: {
					$geometry: vendorLocation, // The Vendor's [lng, lat]
					$maxDistance: 3000,
				},
			},
		});

		// 2. Broadcast to these specific riders via Socket.io
		if (global.io && nearbyRiders.length > 0) {
			nearbyRiders.forEach((rider) => {
				// Emit to the rider's User ID (owner of the profile)
				global.io.to(rider.user.toString()).emit("newOrderAvailable", {
					orderId: orderId,
					message: "New delivery request nearby!",
				});
			});
			logger.info(`Pings sent to ${nearbyRiders.length} riders.`);
		}

		return nearbyRiders;
	} catch (error) {
		logger.error(`Error finding riders: ${error.message}`);
	}
};

// --- Core Service Methods ---

const createOrder = async (userId, data) => {
	const { items, vendorId, deliveryAddress } = data;

	if (!mongoose.isValidObjectId(vendorId)) {
		throw new Error(`Invalid Vendor ID: ${vendorId}`);
	}

	if (!items || items.length === 0) {
		throw new Error("No items in the order.");
	}

	// 1. Identify Zone
	const orderZone = identifyZone(deliveryAddress);

	// 2. Fetch Vendor
	const vendor = await VendorProfile.findById(vendorId);
	if (!vendor) throw new Error("Vendor not found");
	if (!vendor.location || !vendor.location.coordinates) {
		throw new Error("Vendor has no location set");
	}

	// 3. Calculate Fee
	const vendorAddress = vendor.location ? vendor.location.address : null;

	if (!vendorAddress) {
		throw new Error("Vendor address is missing");
	}

	const fee = await calculateOunjeFee(vendorAddress, deliveryAddress);
	// calculateOunjeFee now throws specific errors, so no need to check for null

	let itemsTotalPrice = 0;
	const orderItems = [];
	const models = { FoodItem, Dish: Combo, Plate };

	for (const item of items) {
		const { itemId, itemType, quantity = 1, notes } = item;

		if (!mongoose.isValidObjectId(itemId)) {
			throw new Error(`Invalid Item ID: ${itemId}`);
		}

		if (!itemId || !itemType || !models[itemType]) continue;

		const ProductModel = models[itemType];
		const product = await ProductModel.findById(itemId).select("price");

		if (product) {
			const itemPrice = product.price;
			itemsTotalPrice += itemPrice * quantity;
			orderItems.push({
				itemType,
				item: itemId,
				quantity,
				price: itemPrice,
				notes,
			});
		}
	}

	// 4. Lookup Customer document ID from User ID
	const customer = await Customer.findOne({ user: userId });
	if (!customer) throw new Error("Customer profile not found");

	// 5. Create Order
	const order = await Order.create({
		customer: customer._id, // Use Customer document ID, not User ID
		vendor: vendorId,
		items: orderItems,
		totalPrice: itemsTotalPrice + fee,
		deliveryFee: fee,
		deliveryAddress,
		status: ORDER_STATUS.CONFIRMING,
		subStatus: ORDER_SUB_STATUS.CONFIRMING,
		zone: orderZone,
	});

	// 6. Send notification to vendor
	try {
		await notificationService.notifyNewOrder(vendorId, order);
		logger.info(`New order notification sent to vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send new order notification: ${error.message}`);
	}

	return order;
};

const updateOrderStatus = async (orderId, status, subStatus) => {
	const order = await Order.findById(orderId).populate("customer");
	if (!order) throw new Error("Order not found");

	// Update Database
	order.status = status;
	order.subStatus = subStatus || "";
	await order.save();

	// Send Real-Time Update to the specific Customer
	if (global.io) {
		global.io.to(order.customer._id.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
		logger.info(
			`Real-time update sent to Customer ${order.customer._id}: ${status}`,
		);
	}

	// Firebase Notification
	if (order.customer && order.customer.fcmToken) {
		const title = `Order Update: ${status}`;
		const body = subStatus || `Your order is now ${status}`;
		await sendPushNotification(order.customer.fcmToken, title, body);
	}

	// Trigger Rider Search if needed
	if (
		status === ORDER_STATUS.RIDING &&
		subStatus === ORDER_SUB_STATUS.LOOKING_FOR_RIDER
	) {
		const vendor = await VendorProfile.findById(order.vendor);
		await findNearbyRiders(vendor.location, order._id);
	}

	return order;
};

const sendDeliveryOtp = async (order) => {
	if (!order) throw new Error("Order required");
	const customer = await Customer.findById(order.customer);
	if (!customer) throw new Error("Customer not found");

	const otp = generateNumericOtp(
		parseInt(process.env.DELIVERY_OTP_LENGTH || 6),
	);
	const otpHash = hashOtp(otp);
	const duration = parseInt(process.env.DELIVERY_OTP_DURATION || 5); // minutes

	order.deliveryOtpCode = otp;
	logger.info(`Generated OTP for order ${order._id}: ${otp}`);
	order.deliveryOtpHash = otpHash;
	order.deliveryOtpSentAt = new Date();
	order.deliveryOtpExpiresAt = new Date(Date.now() + duration * 60 * 1000);
	await order.save();

	// Emit via socket.io
	try {
		if (global.io) {
			global.io.emit("delivery-otp", {
				orderId: order._id,
				customerId: order.customer,
				otp,
				expiresAt: order.deliveryOtpExpiresAt,
			});
		}
	} catch (err) {
		logger.error(`Failed to emit delivery OTP via socket.io: ${err.message}`);
	}

	return { success: true };
};

const verifyDeliveryOtp = async (order, otp, riderId) => {
	if (!order) throw new Error("Order required");
	if (!otp) throw new Error("OTP required");
	if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt)
		throw new Error("No OTP session found for this order");

	// Expiry check
	if (new Date() > new Date(order.deliveryOtpExpiresAt))
		throw new Error("OTP expired");

	const providedHash = hashOtp(otp);
	if (providedHash !== order.deliveryOtpHash) throw new Error("Invalid OTP");

	order.status = ORDER_STATUS.DELIVERED;
	order.subStatus = ORDER_SUB_STATUS.DELIVERED;
	order.deliveryConfirmedAt = new Date();
	order.deliveryConfirmedBy = riderId;

	// Clear OTP fields
	order.deliveryOtpCode = null;
	order.deliveryOtpHash = null;
	order.deliveryOtpExpiresAt = null;
	order.deliveryOtpSentAt = null;

	// RELEASE THE MONEY TO RIDER WALLET
	await ledgerService.releaseRiderFee(order.rider, order._id);
	await order.save();

	// Trigger automatic payouts asynchronously
	try {
		logger.info(`Triggering auto payouts for order ${order._id}`);
		if (order.rider) {
			await ledgerService.releaseRiderFee(order.rider, order._id);
		}
	} catch (err) {
		logger.error(`Auto payout failed for order ${order._id}: ${err.message}`);
	}

	return { success: true };
};

// --- Core Service Methods ---

const acceptOrder = async (orderId, riderId) => {
	// Atomic update to prevent race conditions
	// Accept orders that are either PENDING or actively looking for a rider
	const order = await Order.findOneAndUpdate(
		{
			_id: orderId,
			$or: [
				{ status: ORDER_STATUS.PENDING, rider: null },
				{
					status: ORDER_STATUS.RIDING,
					subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
					rider: null,
				},
			],
		},
		{
			$set: {
				rider: riderId,
				status: ORDER_STATUS.RIDING,
				subStatus: ORDER_SUB_STATUS.RIDER_ASSIGNED,
			},
		},
		{ new: true },
	).populate("rider", "name");

	if (!order) {
		// Double check if it was just because of status or if it doesn't exist
		const existingOrder = await Order.findById(orderId);
		if (!existingOrder) throw new Error("Order not found");

		throw new Error(
			"Order is no longer available. Another rider may have accepted it.",
		);
	}

	// Notify Customer about rider assignment
	try {
		const riderName = order.rider?.name || "A rider";
		await notificationService.notifyCustomerRiderAssigned(
			order.customer,
			order,
			riderName,
		);
		logger.info(
			`Rider assignment notification sent to customer ${order.customer}`,
		);
	} catch (error) {
		logger.error(
			`Failed to send rider assignment notification: ${error.message}`,
		);
	}

	// Notify Customer via Socket.io
	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			message: "A rider has accepted your order and is on the way!",
		});
		logger.info(`Rider ${riderId} accepted Order ${orderId}`);
	}

	return order;
};

const pickUpOrder = async (orderId, riderId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.rider.toString() !== riderId) {
		throw new Error("You are not the assigned rider for this order");
	}

	order.status = ORDER_STATUS.RIDING;
	order.subStatus = ORDER_SUB_STATUS.PICKED_UP;
	await order.save();

	// Send OTP to customer
	await sendDeliveryOtp(order);

	// Notify customer that order has been picked up
	try {
		await notificationService.notifyCustomerOrderPickedUp(
			order.customer,
			order,
		);
		logger.info(
			`Order picked up notification sent to customer ${order.customer}`,
		);
	} catch (error) {
		logger.error(`Failed to send pickup notification: ${error.message}`);
	}

	return order;
};

const completeDelivery = async (orderId, riderId, otp) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.rider.toString() !== riderId) {
		throw new Error("Not assigned to you");
	}

	await verifyDeliveryOtp(order, otp, riderId);

	// Notify customer about delivery completion
	try {
		await notificationService.notifyCustomerDeliveryComplete(
			order.customer,
			order,
		);
		logger.info(
			`Delivery completion notification sent to customer ${order.customer}`,
		);
	} catch (error) {
		logger.error(
			`Failed to send delivery completion notification: ${error.message}`,
		);
	}

	// Real-time update
	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: ORDER_STATUS.DELIVERED,
			subStatus: ORDER_SUB_STATUS.DELIVERED,
			message: "Delivery confirmed! Enjoy your meal.",
		});
		logger.info(`Order ${orderId} delivered by Rider ${riderId}`);
	}

	return order;
};

const cancelOrder = async (orderId, userId, userRole) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	// Validate cancellation permissions
	if (userRole === "customer" && order.customer.toString() !== userId) {
		throw new Error("You can only cancel your own orders");
	}
	if (userRole === "vendor" && order.vendor.toString() !== userId) {
		throw new Error("You can only cancel orders from your restaurant");
	}

	// Prevent cancellation of already delivered orders
	if (order.status === ORDER_STATUS.DELIVERED) {
		throw new Error("Cannot cancel a delivered order");
	}

	order.status = ORDER_STATUS.CANCELLED;
	order.subStatus = ORDER_SUB_STATUS.CANCELLED;
	order.cancelledAt = new Date();
	order.cancelledBy = userId;
	await order.save();

	// Notify vendor about cancellation
	try {
		await notificationService.notifyOrderCancelled(order.vendor, order);
		logger.info(
			`Order cancellation notification sent to vendor ${order.vendor}`,
		);
	} catch (error) {
		logger.error(`Failed to send cancellation notification: ${error.message}`);
	}

	return order;
};

// --- Rider Dashboard Queries ---

const getAvailableRiderRequests = async () => {
	try {
		// Look for orders that are ready for rider assignment
		// This includes orders in PENDING status or orders actively looking for a rider
		const orders = await Order.find({
			$or: [
				{ status: ORDER_STATUS.PENDING, rider: null },
				{
					status: ORDER_STATUS.RIDING,
					subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
					rider: null,
				},
			],
		})
			.populate("vendor", "name location")
			.populate({
				path: "customer",
				select: "name user",
				populate: {
					path: "user",
					select: "name",
				},
			})
			.sort({ createdAt: -1 })
			.lean();

		return orders;
	} catch (error) {
		logger.error(`Error fetching available rider requests: ${error.message}`);
		throw new Error("Failed to fetch available orders");
	}
};

const getCurrentRiderOrder = async (riderId) => {
	return await Order.findOne({
		rider: riderId,
		status: ORDER_STATUS.RIDING,
	})
		.populate("vendor", "name address phone")
		.populate("customer", "name address phone location")
		.populate("items.item");
};

const getRiderCompletedOrdersToday = async (userId) => {
	const riderProfile = await RiderProfile.findOne({ user: userId });
	if (!riderProfile) {
		throw new Error("Rider profile not found");
	}

	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);

	const endOfDay = new Date();
	endOfDay.setHours(23, 59, 59, 999);

	return await Order.find({
		rider: riderProfile._id,
		status: ORDER_STATUS.DELIVERED,
		deliveryConfirmedAt: { $gte: startOfDay, $lte: endOfDay },
	}).select("totalPrice deliveryFee deliveryConfirmedAt");
};

const getRiderOrders = async (riderId, statusFilter) => {
	const filter = { rider: riderId };

	if (statusFilter === "pending") {
		// Orders available for pickup (rider assigned but not picked up yet)
		filter.status = ORDER_STATUS.RIDING;
		filter.subStatus = ORDER_SUB_STATUS.RIDER_ASSIGNED;
	} else if (statusFilter === "active") {
		// Orders currently being delivered (picked up but not delivered)
		filter.status = ORDER_STATUS.RIDING;
		filter.subStatus = ORDER_SUB_STATUS.PICKED_UP;
	} else if (statusFilter === "completed") {
		// Delivered orders
		filter.status = ORDER_STATUS.DELIVERED;
		filter.subStatus = ORDER_SUB_STATUS.DELIVERED;
	}

	return await Order.find(filter)
		.populate("vendor", "name")
		.populate("customer", "name")
		.select(
			"totalPrice status subStatus deliveryFee deliveryConfirmedAt updatedAt createdAt",
		)
		.sort({ createdAt: -1 });
};

module.exports = {
	createOrder,
	updateOrderStatus,
	sendDeliveryOtp,
	verifyDeliveryOtp,
	acceptOrder,
	pickUpOrder,
	completeDelivery,
	cancelOrder,
	getAvailableRiderRequests,
	getCurrentRiderOrder,
	getRiderCompletedOrdersToday,
	getRiderOrders,
	generateNumericOtp,
	hashOtp,
};
