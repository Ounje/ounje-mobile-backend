const mongoose = require("mongoose");
const { Order, RiderProfile, VendorProfile } = require("../models");
const notificationService = require("./notification.service");
const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utils/constants");
const logger = require("../utils/logger");

const getRiderDeclineReasonText = (reason) => {
	const reasonTexts = {
		rider_cannot_reach_vendor: "Cannot reach vendor",
		rider_cannot_reach_customer: "Cannot reach customer",
		rider_vehicle_issue: "Vehicle issue",
		rider_other: "Other reason",
	};
	return reasonTexts[reason] || reason;
};

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

const riderDeclineOrder = async (orderId, riderId, declineData = {}) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.rider && order.rider.toString() !== riderId) {
		throw new Error("You can only decline orders assigned to you");
	}

	if (order.status !== ORDER_STATUS.RIDING) {
		throw new Error("Order can only be declined if it's in riding status");
	}

	const { reason, note } = declineData;

	if (!reason) throw new Error("Decline reason is required");

	const validRiderDeclineReasons = [
		"rider_cannot_reach_vendor",
		"rider_cannot_reach_customer",
		"rider_vehicle_issue",
		"rider_other",
	];

	if (!validRiderDeclineReasons.includes(reason)) {
		throw new Error("Invalid decline reason");
	}

	order.rider = null;
	order.status = ORDER_STATUS.RIDING;
	order.subStatus = ORDER_SUB_STATUS.LOOKING_FOR_RIDER;
	order.cancelledAt = new Date();
	order.cancelledBy = riderId;
	order.cancellationReason = reason;
	order.cancellationNote = note || null;
	order.cancellationCategory = "rider";

	await order.save();

	try {
		await notificationService.notifyCustomerRiderDeclined(
			order.customer,
			order,
			{ reason: getRiderDeclineReasonText(reason), note },
		);
		logger.info(
			`Order ${orderId} declined by rider ${riderId} with reason: ${reason}`,
		);
	} catch (error) {
		logger.error(`Failed to send rider decline notification: ${error.message}`);
	}

	try {
		const vendor = await VendorProfile.findById(order.vendor);
		if (vendor && vendor.location) {
			await findNearbyRiders(vendor.location, order._id);
		}
	} catch (error) {
		logger.error(`Failed to notify riders after decline: ${error.message}`);
	}

	if (global.io) {
		global.io.to(order.customer.toString()).emit("riderDeclined", {
			orderId: order._id,
			reason: getRiderDeclineReasonText(reason),
			note,
			timestamp: order.cancelledAt,
		});
	}

	return order;
};

const getAvailableRiderRequests = async (riderZones = []) => {
	try {
		// Only return orders in the rider's operating zones.
		// If the rider has no zones configured yet, return nothing.
		if (riderZones.length === 0) return [];

		// Only show orders created in the last 24 hours to prevent
		// stale seeded/test orders from appearing in the rider's feed.
		const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

		const orders = await Order.find({
			zone: { $in: riderZones },
			createdAt: { $gte: since },
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
	// Only treat orders updated within the last 12 hours as "active".
	// Orders stuck in RIDING status beyond 12 h are stale (e.g. test data)
	// and should not block the rider's home screen.
	const staleThreshold = new Date(Date.now() - 12 * 60 * 60 * 1000);
	return await Order.findOne({
		rider: riderId,
		status: ORDER_STATUS.RIDING,
		updatedAt: { $gte: staleThreshold },
	})
		.populate("vendor", "name address phone location")
		.populate("customer", "name address phone location")
		.populate("items.item");
};

const getRiderCompletedOrdersToday = async (riderProfileId) => {

	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);

	const endOfDay = new Date();
	endOfDay.setHours(23, 59, 59, 999);

	return await Order.find({
		rider: riderProfileId,
		status: ORDER_STATUS.DELIVERED,
		deliveryConfirmedAt: { $gte: startOfDay, $lte: endOfDay },
	})
		.select("totalPrice deliveryFee deliveryConfirmedAt vendor")
		.populate("vendor", "name");
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
	riderDeclineOrder,
	getAvailableRiderRequests,
	getCurrentRiderOrder,
	getRiderCompletedOrdersToday,
	getRiderOrders,
};
