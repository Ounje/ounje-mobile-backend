const orderService = require("../services/order.service");
const orderVendorService = require("../services/order.vendor.service");
const orderRiderService = require("../services/order.rider.service");
const { Order, Customer, VendorProfile } = require("../models");
const logger = require("../utils/logger");
const { paginate } = require("../utils/paginate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { calculateOunjeFeeFromCoords, buildFeeBreakdown } = require("../utils/delivery");

const cleanOrderItems = (items) => {
  if (items && Array.isArray(items)) {
    items.forEach((item) => {
      if (
        item.itemType !== "Combo" &&
        item.comboSelections &&
        item.comboSelections.length === 0
      ) {
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
    amount: orderObj.deliveryFee ?? 0, // Riders earn delivery fee only
    vendor: orderObj.vendor
      ? {
          id: orderObj.vendor._id || orderObj.vendor,
          name: orderObj.vendor.name || "Unknown Vendor",
          phone: orderObj.vendor.phone || null,
          address:
            orderObj.vendor.address ||
            orderObj.vendor.location?.address ||
            null,
          location: orderObj.vendor.location || null,
        }
      : null,
    customer: orderObj.customer
      ? {
          id: orderObj.customer._id || orderObj.customer,
          name: orderObj.customer.name || null,
          phone: orderObj.customer.phone || null,
          address: orderObj.customer.address || null,
        }
      : orderObj.customer,
  };
};

// Estimate Order Price (no order created — used by PaymentScreen before checkout)
exports.estimateOrder = asyncHandler(async (req, res) => {
  const estimate = await orderService.estimateOrderPrice(req.body);
  res.status(200).json({ success: true, ...estimate });
});

// Delivery fee estimate — GET /api/orders/delivery-estimate?vendorId=xxx
// Uses haversine (no Google Maps call) so it's fast and cheap for previewing fees
exports.getDeliveryEstimate = asyncHandler(async (req, res) => {
  const { vendorId } = req.query;
  if (!vendorId) throw new AppError("vendorId is required", 400);

  const vendor = await VendorProfile.findById(vendorId).select("location");
  if (!vendor?.location?.coordinates?.length) {
    throw new AppError("Vendor location not available", 404);
  }

  const [vLng, vLat] = vendor.location.coordinates;

  // Use customer's first saved address coordinates if available
  const customer = await Customer.findOne({ user: req.user.id }).select("savedAddresses");
  const savedCoords = customer?.savedAddresses?.[0]?.coordinates;

  if (!savedCoords?.length) {
    // No customer location — return minimum base fee as a lower-bound estimate
    return res.status(200).json({ success: true, deliveryFee: 500, distanceKm: null, estimated: true });
  }

  const [cLng, cLat] = savedCoords;
  const { fee, distanceKm } = calculateOunjeFeeFromCoords(vLng, vLat, cLng, cLat);
  const breakdown = buildFeeBreakdown(distanceKm);

  res.status(200).json({ success: true, deliveryFee: fee, distanceKm, breakdown });
});

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

  const order = await orderService.cancelOrder(
    orderId,
    req.customer._id.toString(),
  );
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
    result.data = result.data.map((orderDoc) => {
      const orderObj = orderDoc.toObject ? orderDoc.toObject() : orderDoc;
      cleanOrderItems(orderObj.items);
      return orderObj;
    });
  }

  res.status(200).json(result);
});

// Get single order (customer only)
// Get single order (customer only)
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate("vendor", "name profileImage location")
    .populate("items.item")
    .populate("customer")
    .populate("rider");

  if (!order) throw new AppError("Order not found", 404);

  if (order.customer._id.toString() !== req.customer._id.toString()) {
    throw new AppError("Unauthorized", 403);
  }

  const orderObj = order.toObject();
  cleanOrderItems(orderObj.items);

  // Fetch rider user details manually
  if (orderObj.rider) {
    // Remove sensitive fields
    delete orderObj.rider.bankDetails;
    delete orderObj.rider.earnings;
    delete orderObj.rider.fcmToken;
    delete orderObj.rider.deletedAt;
    delete orderObj.rider.deletedBy;
    delete orderObj.rider.notificationPreferences;

    // Fetch user details using the raw rider (before toObject) to preserve ObjectId
    if (order.rider && order.rider.user) {
      const { User } = require("../models");
      const riderUser = await User.findById(order.rider.user).select(
        "name phone profileImage",
      );
      if (riderUser) {
        orderObj.rider.user = {
          _id: riderUser._id,
          name: riderUser.name,
          phone: riderUser.phone,
          profileImage: riderUser.profileImage,
        };
      }
    }
  }

  res.status(200).json({ success: true, order: orderObj });
});

// Vendor accepts order
exports.vendorAcceptOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const vendorId = req.vendor._id;

  const order = await orderVendorService.vendorAcceptOrder(
    orderId,
    vendorId.toString(),
  );
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

  const order = await orderVendorService.declineOrder(
    orderId,
    vendorId.toString(),
    req.body,
  );

  res.status(200).json({
    success: true,
    message: "Order declined successfully",
    order,
  });
});

// Vendor starts preparing (packaging/packaging)
exports.vendorStartPreparing = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const vendorId = req.vendor._id;

  const order = await orderVendorService.vendorStartPreparing(
    orderId,
    vendorId.toString(),
  );
  res.status(200).json({
    success: true,
    message: "Order preparation started",
    order,
  });
});

// Vendor marks order as ready for pickup
exports.vendorMarkReady = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const vendorId = req.vendor._id;

  const order = await orderVendorService.vendorMarkReady(
    orderId,
    vendorId.toString(),
  );
  res.status(200).json({
    success: true,
    message: "Order marked as ready for pickup",
    order,
  });
});

// Vendor decline statistics
exports.getVendorDeclineStats = asyncHandler(async (req, res) => {
  const vendorId = req.vendor._id;
  const stats = await orderVendorService.getDeclineStats(
    vendorId.toString(),
    req.query,
  );
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

// Rider marks on the way (riding/on_the_way)
exports.riderMarkOnTheWay = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const riderId = req.rider._id;

  const order = await orderRiderService.riderMarkOnTheWay(
    orderId,
    riderId.toString(),
  );
  res.status(200).json({
    success: true,
    message: "Status updated: on the way to customer",
    order: formatRiderOrder(order),
  });
});

// Rider marks arrived at customer
exports.riderMarkArrived = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const riderId = req.rider._id;

  const order = await orderRiderService.riderMarkArrived(
    orderId,
    riderId.toString(),
  );
  res.status(200).json({
    success: true,
    message: "Status updated: rider arrived at customer",
    order: formatRiderOrder(order),
  });
});

// Rider completes delivery
exports.completeDelivery = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { otp } = req.body;
  const { RiderProfile } = require("../models");
  const riderProfile = await RiderProfile.findOne({ user: req.user.id });
  if (!riderProfile) throw new AppError("Rider profile not found", 404);
  const riderId = riderProfile._id;

  const order = await orderService.completeDelivery(
    orderId,
    riderId.toString(),
    otp,
  );
  res.status(200).json({
    success: true,
    message: "Delivery completed successfully",
    order: formatRiderOrder(order),
  });
});

// Get available rider requests
exports.getAvailableRiderRequests = asyncHandler(async (req, res) => {
  // Filter to the rider's own operating zones so riders never see
  // orders outside their area (and demo seed data from other zones is hidden).
  const riderZones = req.rider?.operatingArea ?? [];
  const orders = await orderRiderService.getAvailableRiderRequests(riderZones);
  res.status(200).json({
    count: orders.length,
    orders: orders.map(formatRiderOrder),
  });
});

// Get current active rider order
exports.getCurrentRiderOrder = asyncHandler(async (req, res) => {
  const riderId = req.rider._id;
  const order = await orderRiderService.getCurrentRiderOrder(
    riderId.toString(),
  );

  res.status(200).json({
    order: formatRiderOrder(order),
    message: order ? undefined : "No active order",
  });
});

// Rider completed orders today
exports.getRiderCompletedOrdersToday = asyncHandler(async (req, res) => {
  const orders = await orderRiderService.getRiderCompletedOrdersToday(
    req.rider._id.toString(),
  );
  res.status(200).json({
    count: orders.length,
    orders: orders.map(formatRiderOrder),
  });
});

// Rider order history with filters
exports.getRiderOrders = asyncHandler(async (req, res) => {
  const riderId = req.rider._id;
  const { status } = req.query;

  const orders = await orderRiderService.getRiderOrders(
    riderId.toString(),
    status,
  );
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
  const orders = await orderVendorService.getVendorOrders(
    req.vendor._id.toString(),
    req.query,
  );

  const cleanedOrders = orders.map((orderDoc) => {
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

// Get single order by ID for rider (rider must be assigned or order must be available)
exports.getRiderOrderById = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  // Order.rider references RiderProfile._id, so compare against req.rider._id
  const riderProfileId = req.rider._id.toString();

  const order = await Order.findById(orderId)
    .populate("vendor", "name address phone location")
    .populate("customer", "name phone address location")
    .populate("items.item");

  if (!order) throw new AppError("Order not found", 404);

  // Allow if: rider is assigned to this order, OR order is still available (no rider)
  const isAssigned = order.rider && order.rider.toString() === riderProfileId;
  const isAvailable = !order.rider;

  if (!isAssigned && !isAvailable) {
    throw new AppError("You are not authorized to view this order", 403);
  }

  res.status(200).json({ success: true, order: formatRiderOrder(order) });
});

exports.resendDeliveryOtp = asyncHandler(async (req, res) => {
	const { orderId } = req.params;

	// Works for both customer and rider
	const result = await orderService.resendDeliveryOtp(
		orderId,
		req.user.id,
		req.user.role,
	);
	res.status(200).json(result);
});

// Rider rejects a dispatch request (before accepting — advances queue to next rider)
exports.rejectDispatch = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const riderUserId = req.user.id;
  await orderRiderService.rejectDispatch(orderId, riderUserId);
  res.status(200).json({ success: true, message: "Dispatch rejected" });
});

// Rider reports a delivery issue
exports.reportDelivery = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  // Order.rider references RiderProfile._id
  const riderProfileId = req.rider._id.toString();
  const { note } = req.body;

  if (!note || !note.trim()) {
    throw new AppError("Report note is required", 400);
  }

  const order = await Order.findById(orderId);
  if (!order) throw new AppError("Order not found", 404);

  // Only the rider who was assigned to this order can report it
  if (!order.rider || order.rider.toString() !== riderProfileId) {
    throw new AppError("You are not authorized to report this order", 403);
  }

  // Prevent duplicate reports
  if (order.riderReport && order.riderReport.reportedAt) {
    throw new AppError("This delivery has already been reported", 400);
  }

  order.riderReport = {
    reportedAt: new Date(),
    reportedBy: riderProfileId,
    note: note.trim(),
  };
  await order.save();

  logger.info(
    `Delivery report submitted: order ${orderId} by rider ${riderProfileId}`,
  );
  res.status(200).json({
    success: true,
    message: "Report submitted. Our team will look into it.",
  });
});
