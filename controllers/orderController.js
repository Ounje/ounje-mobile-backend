const Order = require("../models/Order");
const Vendor = require("../models/Vendor");
const Combo = require("../models/Combo");
const FoodItem = require("../models/FoodItem");
const Plate = require("../models/Plate");
const { calculateOunjeFee, identifyZone } = require("../utilis/delivery");
const crypto = require("crypto");
const payoutService = require("../services/payout.service");
const Customer = require("../models/Customer");
const { sendPushNotification } = require("../services/notification.service");
const Rider = require("../models/Rider");
const ledgerService = require("../services/ledger.service");
const { notificationService } = require("../services/notification.service");

// Helper: generate secure numeric OTP of given length
const generateNumericOtp = (length = 6) => {
	let otp = "";
	for (let i = 0; i < length; i++) otp += crypto.randomInt(0, 10).toString();
	return otp;
};

const hashOtp = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

// Create a new order
exports.createOrder = async (req, res) => {
	try {
		const { items, vendorId, deliveryAddress } = req.body;
		const userId = req.user.id;

		if (!items || items.length === 0) {
			return res.status(400).json({ message: "No items in the order." });
		}

		// 1. Identify Zone
		const orderZone = identifyZone(deliveryAddress);

		// 2. Fetch Vendor
		const vendor = await Vendor.findById(vendorId);
		if (!vendor) return res.status(404).json({ message: "Vendor not found" });
		if (!vendor.address)
			return res.status(400).json({ message: "Vendor has no address set" });

		// 3. Calculate Fee (Check for null!)
		const fee = await calculateOunjeFee(vendor.address, deliveryAddress);
		if (fee === null) {
			return res.status(400).json({
				message: "Google Maps could not calculate distance. Check addresses.",
			});
		}

		let itemsTotalPrice = 0;
		const orderItems = [];
		const models = { FoodItem, Dish: Combo, Plate };

		for (const item of items) {
			const { itemId, itemType, quantity = 1, notes } = item;
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

		// 4. Create Order
		const order = await Order.create({
			customer: userId,
			vendor: vendorId,
			items: orderItems,
			totalPrice: itemsTotalPrice + fee,
			deliveryFee: fee,
			deliveryAddress,
			status: "CONFIRMING",
			subStatus: "CONFIRMING",
			zone: orderZone,
		});

		// 🔔 NOTIFY CUSTOMER: Order created, pending payment
		await notificationService.createNotification({
			recipient: userId,
			recipientModel: "customer",
			type: "order_created",
			title: "Order Created",
			message: `Your order has been created. Total: ${order.totalPrice} NGN. Please complete payment.`,
			data: {
				orderId: order._id,
				totalPrice: order.totalPrice,
			},
			priority: "high",
			actionUrl: `/orders/${order._id}/payment`,
		});

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

		const order = await Order.findById(id).populate("customer vendor");
		if (!order) return res.status(404).json({ message: "Order not found" });

		const oldStatus = order.status;
		order.status = status;
		order.subStatus = subStatus || "";
		await order.save();

		// Send Real-Time Update to the specific Customer
		if (global.io) {
			global.io.to(order.customer.toString()).emit("orderUpdate", {
				orderId: order._id,
				status: order.status,
				subStatus: order.subStatus,
			});
		}

		// 🔔 NOTIFY BASED ON STATUS CHANGES
		await handleStatusNotifications(order, oldStatus, status, subStatus);

		if (status === "Rider Enroute" && subStatus === "Looking for Rider") {
			const vendor = await Vendor.findById(order.vendor);
			await findNearbyRiders(vendor.location, order._id);
		}

		res.status(200).json({ success: true, order });
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to update order", error: error.message });
	}
};

//  HANDLE STATUS CHANGE NOTIFICATIONS
async function handleStatusNotifications(order, oldStatus, newStatus) {
	try {
		// Payment Confirmed
		if (newStatus === "PENDING" && oldStatus === "CONFIRMING") {
			//  NOTIFY VENDOR: New Order!
			await notificationService.createNotification({
				recipient: order.vendor._id,
				recipientModel: "vendor",
				type: "new_order",
				title: "New Order Received!",
				message: `You have a new order for ${order.totalPrice} NGN`,
				data: {
					orderId: order._id,
					totalPrice: order.totalPrice,
					itemCount: order.items.length,
				},
				priority: "high",
				actionUrl: `/vendor/orders/${order._id}`,
			});

			//  NOTIFY CUSTOMER: Payment Confirmed
			await notificationService.createNotification({
				recipient: order.customer._id,
				recipientModel: "customer",
				type: "payment_confirmed",
				title: "Payment Confirmed!",
				message:
					"Your payment has been confirmed. Vendor is preparing your order.",
				data: {
					orderId: order._id,
				},
				priority: "medium",
			});
		}

		// Vendor Preparing Food
		if (newStatus === "PREPARING") {
			await notificationService.createNotification({
				recipient: order.customer._id,
				recipientModel: "customer",
				type: "order_preparing",
				title: "Order Being Prepared",
				message: "The vendor is preparing your order!",
				data: {
					orderId: order._id,
				},
				priority: "medium",
			});
		}

		// Order Ready
		if (newStatus === "READY") {
			await notificationService.createNotification({
				recipient: order.customer._id,
				recipientModel: "customer",
				type: "order_ready",
				title: "Order Ready!",
				message: "Your order is ready! Looking for a rider...",
				data: {
					orderId: order._id,
				},
				priority: "high",
			});
		}

		// Order Delivered
		if (newStatus === "DELIVERED") {
			//  NOTIFY CUSTOMER: Delivered
			await notificationService.createNotification({
				recipient: order.customer._id,
				recipientModel: "customer",
				type: "order_delivered",
				title: "Order Delivered!",
				message: "Your order has been delivered. Enjoy your meal!",
				data: {
					orderId: order._id,
				},
				priority: "high",
				actionUrl: `/orders/${order._id}/review`,
			});

			//  NOTIFY VENDOR: Order Completed
			await notificationService.createNotification({
				recipient: order.vendor._id,
				recipientModel: "vendor",
				type: "order_completed",
				title: "Order Completed",
				message: `Order for ${order.totalPrice} NGN has been delivered successfully.`,
				data: {
					orderId: order._id,
					totalPrice: order.totalPrice,
				},
				priority: "low",
			});
		}

		// Order Cancelled
		if (newStatus === "CANCELLED") {
			//  NOTIFY CUSTOMER
			await notificationService.createNotification({
				recipient: order.customer._id,
				recipientModel: "customer",
				type: "order_cancelled",
				title: "Order Cancelled",
				message: "Your order has been cancelled.",
				data: {
					orderId: order._id,
				},
				priority: "high",
			});

			//  NOTIFY VENDOR
			await notificationService.createNotification({
				recipient: order.vendor._id,
				recipientModel: "vendor",
				type: "order_cancelled",
				title: "Order Cancelled",
				message: `An order has been cancelled.`,
				data: {
					orderId: order._id,
				},
				priority: "medium",
			});
		}
	} catch (error) {
		console.error("Error sending status notifications:", error);
	}
}

exports.sendDeliveryOtp = async (order) => {
	if (!order) throw new Error("Order required");
	const customer = await Customer.findById(order.customer);
	if (!customer) throw new Error("Customer not found");

	const otp = generateNumericOtp(
		parseInt(process.env.DELIVERY_OTP_LENGTH || 6),
	);
	const otpHash = hashOtp(otp);
	const duration = parseInt(process.env.DELIVERY_OTP_DURATION || 5);

	order.deliveryOtpCode = otp;
	console.log("Generated OTP for order", order._id, "OTP:", otp);
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
		console.error("Failed to emit delivery OTP via socket.io:", err.message);
	}

	//  NOTIFY CUSTOMER: OTP Sent
	await notificationService.createNotification({
		recipient: order.customer,
		recipientModel: "customer",
		type: "delivery_otp",
		title: "Delivery OTP",
		message: `Your delivery OTP is: ${otp}. Valid for ${duration} minutes.`,
		data: {
			orderId: order._id,
			otp,
			expiresAt: order.deliveryOtpExpiresAt,
		},
		priority: "urgent",
	});

	return { success: true };
};

exports.verifyDeliveryOtp = async (order, otp, riderId) => {
	if (!order) throw new Error("Order required");
	if (!otp) return { success: false, error: "OTP required" };
	if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt)
		return { success: false, error: "No OTP session found for this order" };

	if (new Date() > new Date(order.deliveryOtpExpiresAt))
		return { success: false, error: "OTP expired" };

	const providedHash = hashOtp(otp);
	if (providedHash !== order.deliveryOtpHash)
		return { success: false, error: "Invalid OTP" };

	order.status = "DELIVERED";
	order.subStatus = "DELIVERED";
	order.deliveryConfirmedAt = new Date();
	order.deliveryConfirmedBy = riderId;

	order.deliveryOtpCode = null;
	order.deliveryOtpHash = null;
	order.deliveryOtpExpiresAt = null;
	order.deliveryOtpSentAt = null;

	await ledgerService.releaseRiderFee(order.rider, order._id);
	await order.save();

	try {
		console.log("Triggering auto payouts for order", order._id);
		if (order.rider) {
			await ledgerService.releaseRiderFee(order.rider, order._id);
		}
	} catch (err) {
		console.error("Auto payout failed for order", order._id, err.message);
	}

	return { success: true };
};

exports.acceptOrder = async (req, res) => {
	try {
		const { orderId } = req.params;
		const riderId = req.user.id;

		const order = await Order.findById(orderId).populate("customer vendor");
		if (!order)
			return res
				.status(404)
				.json({ success: false, message: "Order not found" });

		if (order.status !== "pending" || order.rider) {
			return res.status(400).json({
				success: false,
				message:
					"Order is no longer available. Another rider may have accepted it.",
			});
		}

		order.rider = riderId;
		order.status = "RIDING";
		order.subStatus = "RIDER_ASSIGNED";

		await order.save();

		if (global.io) {
			global.io.to(order.customer.toString()).emit("orderUpdate", {
				orderId: order._id,
				status: order.status,
				message: "A rider has accepted your order and is on the way!",
			});
		}

		await notificationService.createNotification({
			recipient: order.customer._id,
			recipientModel: "customer",
			type: "rider_assigned",
			title: "Rider Assigned!",
			message: "A rider has accepted your order and is heading to the vendor.",
			data: {
				orderId: order._id,
				riderId,
			},
			priority: "high",
		});

		await notificationService.createNotification({
			recipient: order.vendor._id,
			recipientModel: "vendor",
			type: "rider_assigned",
			title: "Rider Assigned",
			message: "A rider has been assigned to pick up the order.",
			data: {
				orderId: order._id,
				riderId,
			},
			priority: "medium",
		});

		return res.status(200).json({
			success: true,
			message: "Order accepted successfully",
			order,
		});
	} catch (error) {
		console.error("ACCEPT_ORDER_ERROR:", error);
		return res.status(500).json({
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

		const order = await Order.findById(orderId).populate("customer vendor");

		if (!order) return res.status(404).json({ message: "Order not found" });

		if (order.rider.toString() !== riderId) {
			return res.status(403).json({
				message: "You are not the assigned rider for this order",
			});
		}

		order.status = "RIDING";
		order.subStatus = "PICKED_UP";
		await order.save();

		await exports.sendDeliveryOtp(order);

		await notificationService.createNotification({
			recipient: order.customer._id,
			recipientModel: "customer",
			type: "order_picked_up",
			title: "Order Picked Up!",
			message: "Your order has been picked up and is on the way to you!",
			data: {
				orderId: order._id,
			},
			priority: "high",
		});

		await notificationService.createNotification({
			recipient: order.vendor._id,
			recipientModel: "vendor",
			type: "order_picked_up",
			title: "Order Picked Up",
			message: "The rider has picked up the order.",
			data: {
				orderId: order._id,
			},
			priority: "low",
		});

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

		const order = await Order.findById(orderId).populate(
			"customer vendor rider",
		);
		if (!order) return res.status(404).json({ message: "Order not found" });

		if (order.rider._id.toString() !== riderId) {
			return res.status(403).json({ message: "Not assigned to you" });
		}

		const result = await exports.verifyDeliveryOtp(order, otp, riderId);

		if (!result.success) {
			return res.status(400).json({ message: result.error || "Invalid OTP" });
		}

		if (global.io) {
			global.io.to(order.customer.toString()).emit("orderUpdate", {
				orderId: order._id,
				status: "DELIVERED",
				subStatus: "DELIVERED",
				message: "Delivery confirmed! Enjoy your meal.",
			});
		}

		await notificationService.createNotification({
			recipient: riderId,
			recipientModel: "rider",
			type: "delivery_completed",
			title: "Delivery Completed!",
			message:
				"You have successfully completed the delivery. Payment released.",
			data: {
				orderId: order._id,
				deliveryFee: order.deliveryFee,
			},
			priority: "high",
		});

		res.status(200).json({
			success: true,
			message: "Delivery completed successfully!",
			order,
		});
	} catch (error) {
		res.status(500).json({
			message: "Delivery completion failed",
			error: error.message,
		});
	}
};

const findNearbyRiders = async (vendorLocation, orderId) => {
	try {
		const nearbyRiders = await Rider.find({
			isOnline: true,
			isAvailable: true,
			lastKnownLocation: {
				$near: {
					$geometry: vendorLocation,
					$maxDistance: 3000,
				},
			},
		});

		if (global.io && nearbyRiders.length > 0) {
			nearbyRiders.forEach((rider) => {
				global.io.to(rider._id.toString()).emit("newOrderAvailable", {
					orderId: orderId,
					message: "New delivery request nearby!",
				});
			});
			console.log(`Pings sent to ${nearbyRiders.length} riders.`);
		}

		for (const rider of nearbyRiders) {
			await notificationService.createNotification({
				recipient: rider._id,
				recipientModel: "rider",
				type: "new_delivery",
				title: "New Delivery Available!",
				message: "A new delivery order is available nearby.",
				data: {
					orderId,
					distance: "Within 3km",
				},
				priority: "high",
				actionUrl: `/rider/orders/${orderId}`,
			});
		}

		return nearbyRiders;
	} catch (error) {
		console.error("Error finding riders:", error);
	}
};
