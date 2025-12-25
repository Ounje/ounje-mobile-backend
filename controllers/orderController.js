const Order = require("../models/Order");
const Vendor = require("../models/Vendor");
const Dish = require("../models/Dish");
const FoodItem = require("../models/FoodItem");
const Plate = require("../models/Plate");
const { calculateOunjeFee, identifyZone } = require('../utilis/delivery');
const crypto = require('crypto');
const payoutService = require("../services/payout.service");
const Customer = require("../models/Customer");

// Helper: generate secure numeric OTP of given length
const generateNumericOtp = (length = 6) => {
  let otp = '';
  for (let i = 0; i < length; i++) otp += crypto.randomInt(0, 10).toString();
  return otp;
};

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');


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
    if (!vendor.address) return res.status(400).json({ message: "Vendor has no address set" });

    // 3. Calculate Fee (Check for null!)
    const fee = await calculateOunjeFee(vendor.address, deliveryAddress);
    if (fee === null) {
      return res.status(400).json({ message: "Google Maps could not calculate distance. Check addresses." });
    }

    let itemsTotalPrice = 0; // Renamed for clarity
    const orderItems = [];
    const models = { FoodItem, Dish, Plate };

    for (const item of items) {
      const { itemId, itemType, quantity = 1, notes } = item;
      if (!itemId || !itemType || !models[itemType]) continue;

      const ProductModel = models[itemType];
      const product = await ProductModel.findById(itemId).select("price");

      if (product) {
        const itemPrice = product.price;
        itemsTotalPrice += (itemPrice * quantity);
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
    return res.status(500).json({ message: "Order failed", error: error.message });
  }
};

// ... other functions (getMyOrders, getOrderById, updateOrderStatus) remain the same ...
// ... (The rest of the file is omitted for brevity but should remain)
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate("vendor", "name")
      .populate("items.item");

    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching orders", error });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("vendor", "name")
      .populate("items.item");

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Ensure only the owner can access their order
    if (order.user.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: "Error fetching order", error });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only allow customer to cancel
    if (
      status === "cancelled" &&
      order.user.toString() !== req.user.id.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    order.status = status;
    await order.save();

    res.status(200).json({ message: "Order updated", order });
  } catch (error) {
    res.status(500).json({ message: "Failed to update order", error });
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

  const otp = generateNumericOtp(parseInt(process.env.DELIVERY_OTP_LENGTH || 6));
  const otpHash = hashOtp(otp);
  const duration = parseInt(process.env.DELIVERY_OTP_DURATION || 5); // minutes

  order.deliveryOtpCode = otp; // short-lived plaintext for app delivery
  order.deliveryOtpHash = otpHash;
  order.deliveryOtpSentAt = new Date();
  order.deliveryOtpExpiresAt = new Date(Date.now() + duration * 60 * 1000);
  await order.save();

  // Emit via socket.io so customer app can receive immediately if connected
  try {
    if (global.io) {
      global.io.emit('delivery-otp', {
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
  if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt) return { success: false, error: "No OTP session found for this order" };

  // Expiry check
  if (new Date() > new Date(order.deliveryOtpExpiresAt)) return { success: false, error: "OTP expired" };

  const providedHash = hashOtp(otp);
  if (providedHash !== order.deliveryOtpHash) return { success: false, error: "Invalid OTP" };

  order.status = "completed";
  order.deliveryConfirmedAt = new Date();
  order.deliveryConfirmedBy = riderId;

  // Clear OTP fields (one-time use)
  order.deliveryOtpCode = null;
  order.deliveryOtpHash = null;
  order.deliveryOtpExpiresAt = null;
  order.deliveryOtpSentAt = null;

  await order.save();

  // Trigger automatic payouts asynchronously; don't block on it fully
  try {
    await payoutService.processAutoPayoutsForOrder(order._id);
  } catch (err) {
    console.error("Auto payout failed for order", order._id, err.message);
  }

  return { success: true };
};
