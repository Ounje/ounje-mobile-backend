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

const notifyRiders = (riders, orderId, order) => {
	riders.forEach((rider) => {
		if (global.io) {
			global.io.to(rider.user.toString()).emit("newOrderAvailable", {
				orderId,
				message: "New delivery request nearby!",
			});
		}

		if (order) {
			notificationService.notifyRiderOrderAvailable(rider.user, order).catch((err) => {
				logger.error(`FCM fallback failed for rider ${rider.user}: ${err.message}`);
			});
		}
	});
};

const findNearbyRiders = async (vendorLocation, orderId) => {
	try {
		// 1. Find all available riders within 15km
		const nearbyRiders = await RiderProfile.find({
			status: "available",
			isActive: true,
			currentLocation: {
				$near: {
					$geometry: vendorLocation,
					$maxDistance: 15000,
				},
			},
		});

		// 2. Fetch order for FCM payload
		const order = await Order.findById(orderId).select("_id deliveryFee zone");

		if (nearbyRiders.length > 0) {
			notifyRiders(nearbyRiders, orderId, order);
			logger.info(`Pings sent to ${nearbyRiders.length} nearby riders.`);
			return nearbyRiders;
		}

		// 3. Fallback: no riders within 15km — broadcast to ALL available riders
		logger.warn(`No riders within 15km for order ${orderId}. Broadcasting to all available riders.`);
		const allRiders = await RiderProfile.find({ status: "available", isActive: true });

		if (allRiders.length > 0) {
			notifyRiders(allRiders, orderId, order);
			logger.info(`Fallback pings sent to ${allRiders.length} riders.`);
		} else {
			logger.warn(`No available riders at all for order ${orderId}.`);
		}

		return allRiders;
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
	getRiderDeclineReasonText,
	findNearbyRiders,
	riderDeclineOrder,
	getAvailableRiderRequests,
	getCurrentRiderOrder,
	getRiderCompletedOrdersToday,
	getRiderOrders
};
