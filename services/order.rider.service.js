const mongoose = require("mongoose");
const { Order, RiderProfile, VendorProfile } = require("../models");
const notificationService = require("./notification.service");
const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utils/constants");
const logger = require("../utils/logger");
const { reverseRiderFeeHold } = require("./ledger.service");

// ── In-memory sequential dispatch queues ────────────────────────────────────
// Map<orderId_string, { queue: RiderProfile[], timerId: NodeJS.Timeout | null }>
const dispatchQueues = new Map();

const DISPATCH_TIMEOUT_MS = 60_000; // 60 seconds per rider

// Haversine distance in km between two [lng, lat] coordinate pairs
function distanceKm(coords1, coords2) {
	const [lng1, lat1] = coords1;
	const [lng2, lat2] = coords2;
	const R = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLng = ((lng2 - lng1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasValidGPS(coords) {
	return (
		Array.isArray(coords) &&
		coords.length === 2 &&
		!(coords[0] === 0 && coords[1] === 0)
	);
}

// ── Build candidate list with fallback chain ─────────────────────────────────
// 1. Zone-matched riders (fastest, most relevant)
// 2. GPS-nearby riders within 5km (catches riders without zone set)
// 3. All available riders, capped at 15 (last resort — no match would mean 0 drivers online)
const _buildCandidateList = async (vendorLocation, orderZone) => {
	// Tier 1: zone
	if (orderZone && orderZone !== "Other") {
		const zone = await RiderProfile.find({
			status: "available",
			isActive: true,
			operatingArea: orderZone,
		}).select("user currentLocation");
		if (zone.length > 0) {
			logger.info(
				`[Dispatch] Zone "${orderZone}" tier: ${zone.length} rider(s) found`,
			);
			return zone;
		}
		logger.warn(
			`[Dispatch] Zone "${orderZone}" tier: 0 riders — falling back to GPS`,
		);
	} else {
		logger.warn(
			`[Dispatch] order.zone="${orderZone}" (unresolved) — skipping zone tier, trying GPS`,
		);
	}

	// Tier 2: GPS within 5km
	const vendorCoords = vendorLocation?.coordinates;
	if (vendorCoords && hasValidGPS(vendorCoords)) {
		try {
			const gps = await RiderProfile.find({
				status: "available",
				isActive: true,
				currentLocation: {
					$near: {
						$geometry: vendorLocation,
						$maxDistance: 3000,
					},
				},
			}).select("user currentLocation");
			if (gps.length > 0) {
				logger.info(`[Dispatch] GPS tier: ${gps.length} rider(s) within 3km`);
				return gps;
			}
			logger.warn(
				`[Dispatch] GPS tier: 0 riders within 3km — falling back to all-available`,
			);
		} catch (gpsErr) {
			logger.warn(
				`[Dispatch] GPS tier failed (no 2dsphere index?): ${gpsErr.message}`,
			);
		}
	} else {
		logger.warn(
			`[Dispatch] Vendor has no valid GPS coords — skipping GPS tier`,
		);
	}

	// Tier 3: All available riders (capped at 15)
	const all = await RiderProfile.find({
		status: "available",
		isActive: true,
	})
		.select("user currentLocation")
		.limit(15);
	logger.warn(`[Dispatch] All-available tier: ${all.length} rider(s) online`);
	return all;
};

// ── Start sequential dispatch for an order ───────────────────────────────────
const startDispatch = async (orderId, vendorLocation, orderZone) => {
	const orderIdStr = orderId.toString();

	if (dispatchQueues.has(orderIdStr)) {
		logger.warn(
			`[Dispatch] Queue already running for order ${orderIdStr} — skipping duplicate start`,
		);
		return;
	}

	logger.info(
		`[Dispatch] Starting for order ${orderIdStr} | zone="${orderZone}" | vendorCoords=${JSON.stringify(vendorLocation?.coordinates)}`,
	);

	try {
		// Debug: count ALL riders in DB so we can spot status/isActive issues
		const totalRiders = await RiderProfile.countDocuments({});
		const availableRiders = await RiderProfile.countDocuments({
			status: "available",
			isActive: true,
		});
		logger.info(
			`[Dispatch] DB snapshot — total riders: ${totalRiders} | available+active: ${availableRiders}`,
		);

		const candidates = await _buildCandidateList(vendorLocation, orderZone);

		if (!candidates.length) {
			logger.warn(
				`[Dispatch] No available riders found across all tiers for order ${orderIdStr} | zone="${orderZone}" | totalRiders=${totalRiders} | availableRiders=${availableRiders}`,
			);
			await _notifyNoRiders(orderIdStr);
			return;
		}

		// Sort by rankingScore DESC first, then by distance to vendor as tiebreaker.
		// Riders with no GPS coords go to the end regardless of score.
		const vendorCoords = vendorLocation?.coordinates;

		// Re-fetch candidates with rankingScore included
		const candidateIds = candidates.map((r) => r._id);
		const withScore = await RiderProfile.find({
			_id: { $in: candidateIds },
		}).select("user currentLocation rankingScore");

		const sorted = withScore.slice().sort((a, b) => {
			const aC = a.currentLocation?.coordinates;
			const bC = b.currentLocation?.coordinates;
			const aValid = hasValidGPS(aC);
			const bValid = hasValidGPS(bC);
			// Riders without valid GPS always go last
			if (!aValid && !bValid)
				return (b.rankingScore || 0) - (a.rankingScore || 0);
			if (!aValid) return 1;
			if (!bValid) return -1;
			// Both have GPS — primary sort by rankingScore, secondary by distance
			const scoreDiff = (b.rankingScore || 0) - (a.rankingScore || 0);
			if (Math.abs(scoreDiff) > 5) return scoreDiff; // clear score gap → use score
			// Scores within 5 pts → prefer closer rider
			if (!hasValidGPS(vendorCoords)) return scoreDiff;
			return distanceKm(vendorCoords, aC) - distanceKm(vendorCoords, bC);
		});

		dispatchQueues.set(orderIdStr, { queue: sorted, timerId: null });
		logger.info(
			`[Dispatch] Queue ready for order ${orderIdStr}: ${sorted.length} candidate(s) | first rider userId=${sorted[0]?.user}`,
		);

		await _sendNextDispatch(orderIdStr);
	} catch (err) {
		logger.error(
			`[Dispatch] startDispatch crashed for order ${orderIdStr}: ${err.message}`,
		);
	}
};

// ── Send dispatch to the next rider in queue ─────────────────────────────────
const _sendNextDispatch = async (orderIdStr) => {
	const entry = dispatchQueues.get(orderIdStr);
	if (!entry) return; // already cancelled (rider accepted or order gone)

	// Clear any existing timer
	if (entry.timerId) {
		clearTimeout(entry.timerId);
		entry.timerId = null;
	}

	const rider = entry.queue.shift();
	if (!rider) {
		// All riders exhausted
		dispatchQueues.delete(orderIdStr);
		logger.info(
			`All riders exhausted for order ${orderIdStr} — no rider accepted`,
		);
		await _notifyNoRiders(orderIdStr);
		return;
	}

	// Fetch order details for the dispatch payload
	let orderDetails = null;
	try {
		orderDetails = await Order.findById(orderIdStr)
			.populate("vendor", "name location")
			.lean();
	} catch (err) {
		logger.error(
			`Failed to fetch order ${orderIdStr} for dispatch payload: ${err.message}`,
		);
	}

	const riderUserId = rider.user.toString();

	// Track that this rider was offered an order — keeps acceptanceRate accurate
	try {
		const updated = await RiderProfile.findByIdAndUpdate(
			rider._id,
			{ $inc: { ordersOffered: 1 } },
			{ new: true, select: "ordersOffered ordersAccepted" },
		);
		if (updated) {
			const rate =
				updated.ordersOffered > 0
					? Math.round((updated.ordersAccepted / updated.ordersOffered) * 100)
					: 100;
			await RiderProfile.findByIdAndUpdate(rider._id, { acceptanceRate: rate });
			// Update ranking score non-blocking
			const riderSvc = require("./rider.service");
			riderSvc.updateRiderRankingScore(rider._id).catch(() => {});
		}
	} catch (trackErr) {
		logger.warn(`[Dispatch] ordersOffered track failed: ${trackErr.message}`);
	}

	logger.info(
		`[Dispatch] Sending riderDispatch to userId=${riderUserId} for order ${orderIdStr} | global.io=${!!global.io}`,
	);
	if (global.io) {
		global.io.to(riderUserId).emit("riderDispatch", {
			orderId: orderIdStr,
			message: "New delivery request — accept within 60 seconds",
			timeoutSeconds: 60,
			order: orderDetails
				? {
						id: orderDetails._id,
						vendorName: orderDetails.vendor?.name ?? "Vendor",
						vendorAddress: orderDetails.vendor?.location?.address ?? null,
						deliveryAddress: orderDetails.deliveryAddress ?? null,
						deliveryFee: orderDetails.deliveryFee ?? 0,
						totalPrice: orderDetails.totalPrice ?? 0,
						zone: orderDetails.zone ?? null,
					}
				: null,
		});
		logger.info(
			`riderDispatch emitted to rider ${riderUserId} for order ${orderIdStr}`,
		);
	}

	// Push notification — reaches rider even when the app is in the background or killed
	try {
		await notificationService.notifyRiderOrderAvailable(rider._id, {
			_id: orderIdStr,
			deliveryFee: orderDetails?.deliveryFee ?? 0,
			zone: orderDetails?.zone ?? null,
		});
	} catch (pushErr) {
		logger.warn(
			`[Dispatch] Push to rider ${riderUserId} failed: ${pushErr.message}`,
		);
	}

	// Set 60s timeout — advance to next rider if no response
	const timerId = setTimeout(async () => {
		logger.info(
			`60s timeout for rider ${riderUserId} on order ${orderIdStr} — advancing queue`,
		);
		if (global.io) {
			global.io
				.to(riderUserId)
				.emit("riderDispatchExpired", { orderId: orderIdStr });
		}
		await _sendNextDispatch(orderIdStr);
	}, DISPATCH_TIMEOUT_MS);

	entry.timerId = timerId;
};

// ── Cancel dispatch (rider accepted the order) ───────────────────────────────
const cancelDispatch = (orderId) => {
	const orderIdStr = orderId.toString();
	const entry = dispatchQueues.get(orderIdStr);
	if (entry) {
		if (entry.timerId) clearTimeout(entry.timerId);
		dispatchQueues.delete(orderIdStr);
		logger.info(`Dispatch cancelled for order ${orderIdStr} (rider accepted)`);
	}
};

// ── Reject dispatch (rider explicitly rejects before timeout) ────────────────
const rejectDispatch = async (orderId, riderUserId) => {
	const orderIdStr = orderId.toString();
	logger.info(
		`Rider ${riderUserId} rejected dispatch for order ${orderIdStr} — advancing queue`,
	);
	await _sendNextDispatch(orderIdStr);
};

// ── Notify vendor that no riders are available ───────────────────────────────
const _notifyNoRiders = async (orderIdStr) => {
	try {
		const order = await Order.findById(orderIdStr)
			.populate("vendor", "owner")
			.lean();
		if (!order) return;
		const vendorUserId = order.vendor?.owner?.toString() ?? null;
		if (global.io && vendorUserId) {
			global.io.to(vendorUserId).emit("noRidersAvailable", {
				orderId: orderIdStr,
				message: "No riders are currently available for this order.",
			});
		}
	} catch (err) {
		logger.error(`_notifyNoRiders error: ${err.message}`);
	}
};

const getRiderDeclineReasonText = (reason) => {
	const reasonTexts = {
		rider_cannot_reach_vendor: "Cannot reach vendor",
		rider_cannot_reach_customer: "Cannot reach customer",
		rider_vehicle_issue: "Vehicle issue",
		rider_other: "Other reason",
	};
	return reasonTexts[reason] || reason;
};

const riderDeclineOrder = async (orderId, riderId, declineData = {}) => {
	const order = await Order.findById(orderId).populate(
		"vendor",
		"name location",
	);
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

	// Reverse the delivery fee hold so the rider's wallet is restored
	try {
		await reverseRiderFeeHold(riderId, orderId);
	} catch (error) {
		logger.error(
			`Failed to reverse rider fee hold on decline: ${error.message}`,
		);
	}

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

	// Restart sequential dispatch so a new rider can be found
	try {
		const vendorLocation = order.vendor?.location;
		await startDispatch(order._id, vendorLocation, order.zone);
	} catch (error) {
		logger.error(`Failed to restart dispatch after decline: ${error.message}`);
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
	return await Order.findOne({
		rider: riderId,
		status: ORDER_STATUS.RIDING,
		subStatus: {
			$in: [
				ORDER_SUB_STATUS.RIDER_ASSIGNED,
				ORDER_SUB_STATUS.PICKED_UP,
				ORDER_SUB_STATUS.ON_THE_WAY,
				ORDER_SUB_STATUS.RIDER_ARRIVED,
			],
		},
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
		// Orders currently being delivered (assigned, in transit, or picked up)
		filter.status = ORDER_STATUS.RIDING;
		filter.subStatus = {
			$in: [
				ORDER_SUB_STATUS.RIDER_ASSIGNED,
				ORDER_SUB_STATUS.PICKED_UP,
				ORDER_SUB_STATUS.ON_THE_WAY,
			],
		};
		filter.subStatus = {
			$in: [
				ORDER_SUB_STATUS.RIDER_ASSIGNED,
				ORDER_SUB_STATUS.PICKED_UP,
				ORDER_SUB_STATUS.ON_THE_WAY,
			],
		};
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

const riderMarkOnTheWay = async (orderId, riderId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (!order.rider || order.rider.toString() !== riderId) {
		throw new Error("You are not assigned to this order");
	}

	if (order.status !== ORDER_STATUS.RIDING) {
		throw new Error("Order is not in riding status");
	}

	order.subStatus = ORDER_SUB_STATUS.ON_THE_WAY;
	await order.save();

	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
	}

	logger.info(`Order ${orderId} — rider ${riderId} is on the way`);
	return order;
};

const riderMarkArrived = async (orderId, riderId) => {
	logger.info(
		`riderMarkArrived called — orderId: ${orderId}, riderId: ${riderId}`,
	);

	const riderIdStr = riderId.toString();

	// 1. Atomic state transition (prevents race conditions)
	const order = await Order.findOneAndUpdate(
		{
			_id: orderId,
			rider: riderIdStr,
			status: ORDER_STATUS.RIDING,
			subStatus: {
				$in: [
					ORDER_SUB_STATUS.ON_THE_WAY,
					ORDER_SUB_STATUS.PICKED_UP,
					ORDER_SUB_STATUS.RIDER_ARRIVED, // allows idempotency
				],
			},
		},
		{
			$set: { subStatus: ORDER_SUB_STATUS.RIDER_ARRIVED },
		},
		{
			new: true,
		},
	);

	if (!order) {
		logger.warn(
			`riderMarkArrived — invalid transition or order not found: orderId=${orderId}, riderId=${riderIdStr}`,
		);
		throw new Error("Invalid order state or unauthorized rider");
	}

	logger.info(
		`Order updated — status: ${order.status}, subStatus: ${order.subStatus}`,
	);

	// 2. Idempotent payload (safe for re-emits)
	const payload = {
		orderId: order._id.toString(),
		status: order.status,
		subStatus: order.subStatus,
	};

	// 3. Socket emissions (non-blocking safety)
	try {
		if (global.io) {
			const rooms = [order.customer?.toString(), riderIdStr].filter(Boolean);

			rooms.forEach((room) => {
				global.io.to(room).emit("orderUpdate", payload);
			});

			logger.info(`Socket events emitted for order ${orderId}`);
		} else {
			logger.warn(`global.io not available — socket skipped`);
		}
	} catch (err) {
		logger.warn(`Socket emission failed for order ${orderId}: ${err.message}`);
	}

	// 4. Notifications (isolated failure domain)
	try {
		if (order.customer) {
			await notificationService.notifyCustomerRiderArrived(
				order.customer.toString(),
				order,
			);
			logger.info(`Notification sent for order ${orderId}`);
		}
	} catch (err) {
		logger.warn(`Notification failed for order ${orderId}: ${err.message}`);
	}

	logger.info(
		`riderMarkArrived complete — order ${orderId}, rider ${riderIdStr}`,
	);

	return order;
};
module.exports = {
	startDispatch,
	cancelDispatch,
	rejectDispatch,
	riderDeclineOrder,
	getAvailableRiderRequests,
	getCurrentRiderOrder,
	getRiderCompletedOrdersToday,
	getRiderOrders,
	riderMarkOnTheWay,
	riderMarkArrived,
};
