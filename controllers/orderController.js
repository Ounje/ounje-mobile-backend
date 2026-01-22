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
			return res
				.status(400)
				.json({
					message: "Google Maps could not calculate distance. Check addresses.",
				});
		}

		let itemsTotalPrice = 0; // Renamed for clarity
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

		// 4. Create Order (FIXED: using itemsTotalPrice + fee)
		const order = await Order.create({
			customer: userId,
			vendor: vendorId,
			items: orderItems,
			totalPrice: itemsTotalPrice + fee,
			deliveryFee: fee,
			deliveryAddress,
			status: "pending",
			zone: orderZone,
		});

		return res.status(201).json({ success: true, order });
	} catch (error) {
		console.error("CRITICAL ERROR:", error);
		// This return ensures Postman STOPS loading and shows the error
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

		// Ensure only the owner can access their order
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
		// Note: I'm using req.params.id to match your route /:id
		const { id } = req.params;
		const { status, subStatus } = req.body;

		const order = await Order.findById(id).populate("customer");
		if (!order) return res.status(404).json({ message: "Order not found" });

		// Update Database
		order.status = status;
		order.subStatus = subStatus || "";
		await order.save();

		// Send Real-Time Update to the specific Customer
		if (global.io) {
			// order.customer is the ID of the user who made the order
			global.io.to(order.customer.toString()).emit("orderUpdate", {
				orderId: order._id,
				status: order.status,
				subStatus: order.subStatus,
			});
			console.log(
				`Real-time update sent to Customer ${order.customer}: ${status}`,
			);
		}

		// Firebase (Push Notification if app is closed/in pocket)
		if (order.customer && order.customer.fcmToken) {
			const title = `Order Update: ${status}`;
			const body = subStatus || `Your order is now ${status}`;

			await sendPushNotification(order.customer.fcmToken, title, body);
		}

		if (status === "Rider Enroute" && subStatus === "Looking for Rider") {
			const vendor = await Vendor.findById(order.vendor);
			// Start searching for riders!
			await findNearbyRiders(vendor.location, order._id);
		}

		res.status(200).json({ success: true, order });
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to update order", error: error.message });
	}
};

/**
 * Send delivery OTP to the customer (in-app). Generates a secure code, stores it briefly,
 * emits it via socket.io to the customer and returns success.
 * Accepts an Order document (already loaded) and returns { success }
 */
exports.sendDeliveryOtp = async (order) => {
	if (!order) throw new Error("Order required");
	const customer = await Customer.findById(order.customer);
	if (!customer) throw new Error("Customer not found");

	const otp = generateNumericOtp(
		parseInt(process.env.DELIVERY_OTP_LENGTH || 6),
	);
	const otpHash = hashOtp(otp);
	const duration = parseInt(process.env.DELIVERY_OTP_DURATION || 5); // minutes

	order.deliveryOtpCode = otp; // short-lived plaintext for app delivery
	console.log("Generated OTP for order", order._id, "OTP:", otp);
	order.deliveryOtpHash = otpHash;
	order.deliveryOtpSentAt = new Date();
	order.deliveryOtpExpiresAt = new Date(Date.now() + duration * 60 * 1000);
	await order.save();

	// Emit via socket.io so customer app can receive immediately if connected
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

	return { success: true };
};

/**
 * Verify OTP entered by rider and complete order + trigger payouts
 * Returns { success: true } on success
 */
exports.verifyDeliveryOtp = async (order, otp, riderId) => {
	if (!order) throw new Error("Order required");
	if (!otp) return { success: false, error: "OTP required" };
	if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt)
		return { success: false, error: "No OTP session found for this order" };

	// Expiry check
	if (new Date() > new Date(order.deliveryOtpExpiresAt))
		return { success: false, error: "OTP expired" };

	const providedHash = hashOtp(otp);
	if (providedHash !== order.deliveryOtpHash)
		return { success: false, error: "Invalid OTP" };

	order.status = "DELIVERED";
	order.subStatus = "DELIVERED";
	order.deliveryConfirmedAt = new Date();
	order.deliveryConfirmedBy = riderId;

	// Clear OTP fields (one-time use)
	order.deliveryOtpCode = null;
	order.deliveryOtpHash = null;
	order.deliveryOtpExpiresAt = null;
	order.deliveryOtpSentAt = null;

	// RELEASE THE MONEY TO RIDER WALLET
	await ledgerService.releaseRiderFee(order.rider, order._id);
	await order.save();

	// Trigger automatic payouts asynchronously; don't block on it fully
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

// Rider accepts a pending order
exports.acceptOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const riderId = req.user.id; // From your auth middleware

    // 1. Fetch the order
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // 2. Check if the order is still available (must be 'pending')
    // and hasn't been assigned to another rider yet.
    if (order.status !== "pending" || order.rider) {
      return res.status(400).json({ 
        success: false, 
        message: "Order is no longer available. Another rider may have accepted it." 
      });
    }

    // 3. Assign the riderId and update status
    // Using 'assigned' as per your Schema's enum
    order.rider = riderId;
    order.status = "RIDING"; 
    order.subStatus = "RIDER_ASSIGNED";
    
    await order.save();

    // 4. Real-time notification to the Customer that a rider is coming
    if (global.io) {
      global.io.to(order.customer.toString()).emit('orderUpdate', {
        orderId: order._id,
        status: order.status,
        message: "A rider has accepted your order and is on the way!"
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Order accepted successfully", 
      order 
    });

  } catch (error) {
    console.error("ACCEPT_ORDER_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to accept order", error: error.message });
  }
};

exports.pickUpOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const riderId = req.user.id;

    const order = await Order.findById(orderId);

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Security: Only the assigned rider can pick up this order
    if (order.rider.toString() !== riderId) {
      return res.status(403).json({ message: "You are not the assigned rider for this order" });
    }

    // Update status to 'out_for_delivery' (matching your Schema)
    order.status = "RIDING";
    order.subStatus = "PICKED_UP";
    await order.save();

    // TRIGGER: Send the OTP to the customer now that food is moving
    // We call your existing helper function
    await exports.sendDeliveryOtp(order);

    res.status(200).json({ 
      success: true, 
      message: "Order picked up! OTP sent to customer.", 
      order 
    });
  } catch (error) {
    res.status(500).json({ message: "Pickup failed", error: error.message });
  }
};

// Rider enters the OTP to complete the delivery
exports.completeDelivery = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { otp } = req.body;
    const riderId = req.user.id;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Verify this is the right rider
    if (order.rider.toString() !== riderId) {
      return res.status(403).json({ message: "Not assigned to you" });
    }

    // Use your existing helper to check OTP and release funds
    const result = await exports.verifyDeliveryOtp(order, otp, riderId);

    if (!result.success) {
      return res.status(400).json({ message: result.error || "Invalid OTP" });
    }

    // REAL-TIME UPDATE: Tell the customer the food is officially delivered
    if (global.io) {
      global.io.to(order.customer.toString()).emit('orderUpdate', {
        orderId: order._id,
        status: "DELIVERED",
        subStatus: "DELIVERED",
        message: "Delivery confirmed! Enjoy your meal."
      });
    }

    res.status(200).json({ 
      success: true, 
      message: "Delivery completed successfully!", 
      order 
    });
  } catch (error) {
    res.status(500).json({ message: "Delivery completion failed", error: error.message });
  }
};

const findNearbyRiders = async (vendorLocation, orderId) => {
	try {
		// 1. Find all available riders within 3km (3000 meters)
		const nearbyRiders = await Rider.find({
			isOnline: true,
			isAvailable: true,
			lastKnownLocation: {
				$near: {
					$geometry: vendorLocation, // The Vendor's [lng, lat]
					$maxDistance: 3000,
				},
			},
		});

		// 2. Broadcast to these specific riders via Socket.io
		if (global.io && nearbyRiders.length > 0) {
			nearbyRiders.forEach((rider) => {
				global.io.to(rider._id.toString()).emit("newOrderAvailable", {
					orderId: orderId,
					message: "New delivery request nearby!",
				});
			});
			console.log(`Pings sent to ${nearbyRiders.length} riders.`);
		}

		return nearbyRiders;
	} catch (error) {
		console.error("Error finding riders:", error);
	}
};
