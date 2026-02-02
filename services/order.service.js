const Order = require("../models/Order");
const Vendor = require("../models/Vendor");
const Combo = require("../models/Combo");
const FoodItem = require("../models/FoodItem");
const Plate = require("../models/Plate");
const Customer = require("../models/Customer");
const Rider = require("../models/Rider");
const { calculateOunjeFee, identifyZone } = require("../utilis/delivery");
const crypto = require("crypto");
const { sendPushNotification } = require("./notification.service");
const ledgerService = require("./ledger.service");
const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utilis/constants");
const logger = require("../utilis/logger");
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
            logger.info(`Pings sent to ${nearbyRiders.length} riders.`);
        }

        return nearbyRiders;
    } catch (error) {
        logger.error(`Error finding riders: ${error.message}`);
    }
};

// --- Core Service Methods ---

const createOrder = async (userId, data) => {
    // ... (unchanged logic) ...
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
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) throw new Error("Vendor not found");
    if (!vendor.address) throw new Error("Vendor has no address set");

    // 3. Calculate Fee
    const fee = await calculateOunjeFee(vendor.address, deliveryAddress);
    if (fee === null) {
        throw new Error("Google Maps could not calculate distance. Check addresses.");
    }

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

    // 4. Create Order
    const order = await Order.create({
        customer: userId,
        vendor: vendorId,
        items: orderItems,
        totalPrice: itemsTotalPrice + fee,
        deliveryFee: fee,
        deliveryAddress,
        status: ORDER_STATUS.CONFIRMING,
        subStatus: ORDER_SUB_STATUS.CONFIRMING,
        zone: orderZone,
    });

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
            `Real-time update sent to Customer ${order.customer._id}: ${status}`
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
        const vendor = await Vendor.findById(order.vendor);
        await findNearbyRiders(vendor.location, order._id);
    }

    return order;
};

const sendDeliveryOtp = async (order) => {
    if (!order) throw new Error("Order required");
    const customer = await Customer.findById(order.customer);
    if (!customer) throw new Error("Customer not found");

    const otp = generateNumericOtp(
        parseInt(process.env.DELIVERY_OTP_LENGTH || 6)
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
    const order = await Order.findById(orderId);
    if (!order) throw new Error("Order not found");

    // Check availability
    if (order.status !== ORDER_STATUS.PENDING || order.rider) {
        throw new Error("Order is no longer available. Another rider may have accepted it.");
    }

    // Assign rider
    order.rider = riderId;
    order.status = ORDER_STATUS.RIDING;
    order.subStatus = ORDER_SUB_STATUS.RIDER_ASSIGNED;
    await order.save();

    // Notify Customer
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

    return order;
};

const completeDelivery = async (orderId, riderId, otp) => {
    const order = await Order.findById(orderId);
    if (!order) throw new Error("Order not found");

    if (order.rider.toString() !== riderId) {
        throw new Error("Not assigned to you");
    }

    await verifyDeliveryOtp(order, otp, riderId);

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

// --- Rider Dashboard Queries ---

const getAvailableRiderRequests = async () => {
    return await Order.find({
        status: ORDER_STATUS.PENDING,
        rider: null,
    })
        .populate("vendor", "name address location")
        .populate("customer", "name location")
        .sort({ createdAt: -1 });
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

const getRiderCompletedOrdersToday = async (riderId) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    return await Order.find({
        rider: riderId,
        status: ORDER_STATUS.DELIVERED,
        deliveryConfirmedAt: { $gte: startOfDay, $lte: endOfDay },
    }).select("totalPrice deliveryFee deliveryConfirmedAt");
};

module.exports = {
    createOrder,
    updateOrderStatus,
    sendDeliveryOtp,
    verifyDeliveryOtp,
    acceptOrder,
    pickUpOrder,
    completeDelivery,
    getAvailableRiderRequests,
    getCurrentRiderOrder,
    getRiderCompletedOrdersToday,
    generateNumericOtp,
    hashOtp,
};