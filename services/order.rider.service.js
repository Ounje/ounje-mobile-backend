const mongoose = require("mongoose");
const { Order, RiderProfile, VendorProfile } = require("../models");
const notificationService = require("./notification.service");
const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utils/constants");
const logger = require("../utils/logger");
const { reverseRiderFeeHold } = require("./ledger.service");

// ── Broadcast dispatch infrastructure ────────────────────────────────────────
// Map<orderId_string, { candidates: RiderProfile[], timerId: NodeJS.Timeout | null }>
const broadcastTimers = new Map();

const BROADCAST_TIMEOUT_MS = 180_000; // 3 minutes — if nobody accepts, notify vendor

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
// 2. GPS-nearby riders within 3km (catches riders without zone set)
// 3. All available riders, capped at 15 (last resort)
// Ghost rider profiles (User deleted from DB) are filtered out at every tier.
const _buildCandidateList = async (vendorLocation, orderZone) => {
	// Tier 1: zone
	if (orderZone && orderZone !== "Other") {
		const zone = await RiderProfile.find({
			status: "available",
			isActive: true,
			operatingArea: orderZone,
		})
			.populate("user", "_id")
			.select("user currentLocation");

		const validZone = zone.filter(r => r.user != null);
		if (validZone.length > 0) {
			logger.info(
				`[Dispatch] Zone "${orderZone}" tier: ${validZone.length} rider(s) found`,
			);
			return validZone;
		}
		logger.warn(
			`[Dispatch] Zone "${orderZone}" tier: 0 valid riders — falling back to GPS`,
		);
	} else {
		logger.warn(
			`[Dispatch] order.zone="${orderZone}" (unresolved) — skipping zone tier, trying GPS`,
		);
	}

	// Tier 2: GPS within 3km
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
			})
				.populate("user", "_id")
				.select("user currentLocation");

			const validGps = gps.filter(r => r.user != null);
			if (validGps.length > 0) {
				logger.info(`[Dispatch] GPS tier: ${validGps.length} rider(s) within 3km`);
				return validGps;
			}
			logger.warn(
				`[Dispatch] GPS tier: 0 valid riders within 3km — falling back to all-available`,
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
		.populate("user", "_id")
		.select("user currentLocation")
		.limit(15);

	const validAll = all.filter(r => r.user != null);
	logger.warn(`[Dispatch] All-available tier: ${validAll.length} valid rider(s) online`);
	return validAll;
};

// ── Start broadcast dispatch for an order ────────────────────────────────────
const startDispatch = async (orderId, vendorLocation, orderZone) => {
	const orderIdStr = orderId.toString();

	// Clear any existing broadcast timer for this order (e.g. from a retry)
	const existing = broadcastTimers.get(orderIdStr);
	if (existing?.timerId) {
		clearTimeout(existing.timerId);
		broadcastTimers.delete(orderIdStr);
		logger.info(`[Dispatch] Cleared previous broadcast timer for order ${orderIdStr}`);
	}

	logger.info(
		`[Dispatch] Starting BROADCAST for order ${orderIdStr} | zone="${orderZone}" | vendorCoords=${JSON.stringify(vendorLocation?.coordinates)}`,
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
			if (!aValid && !bValid)
				return (b.rankingScore || 0) - (a.rankingScore || 0);
			if (!aValid) return 1;
			if (!bValid) return -1;
			const scoreDiff = (b.rankingScore || 0) - (a.rankingScore || 0);
			if (Math.abs(scoreDiff) > 5) return scoreDiff;
			if (!hasValidGPS(vendorCoords)) return scoreDiff;
			return distanceKm(vendorCoords, aC) - distanceKm(vendorCoords, bC);
		});

		// Store candidates for the orderTaken notification later
		broadcastTimers.set(orderIdStr, { candidates: sorted, timerId: null });

		logger.info(
			`[Dispatch] Broadcasting to ${sorted.length} rider(s) for order ${orderIdStr}`,
		);

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

		const dispatchPayload = {
			orderId: orderIdStr,
			message: "New delivery request — first to accept gets it!",
			timeoutSeconds: 180,
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
		};

		// Send to ALL candidates simultaneously
		for (const rider of sorted) {
			const riderUserId = rider.user.toString();

			// Track ordersOffered for acceptance rate
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
					const riderSvc = require("./rider.service");
					riderSvc.updateRiderRankingScore(rider._id).catch(() => {});
				}
			} catch (trackErr) {
				logger.warn(`[Dispatch] ordersOffered track failed: ${trackErr.message}`);
			}

			// Socket event
			logger.info(
				`[Dispatch] Emitting riderDispatch to userId=${riderUserId} for order ${orderIdStr}`,
			);
			if (global.io) {
				global.io.to(riderUserId).emit("riderDispatch", dispatchPayload);
			}

			// Push notification (reaches rider even when app is backgrounded/killed)
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
		}

		logger.info(
			`[Dispatch] Broadcast complete for order ${orderIdStr}: ${sorted.length} rider(s) notified`,
		);

		// Set 3-minute global timeout — if nobody accepts, notify vendor
		const timerId = setTimeout(async () => {
			// Check if order still has no rider assigned
			try {
				const order = await Order.findById(orderIdStr).select("rider status").lean();
				if (order && !order.rider && order.status === ORDER_STATUS.RIDING) {
					logger.info(
						`[Dispatch] 3-minute broadcast timeout for order ${orderIdStr} — no rider accepted`,
					);
					await _notifyNoRiders(orderIdStr);
				}
			} catch (err) {
				logger.error(`[Dispatch] Timeout check failed: ${err.message}`);
			}
			broadcastTimers.delete(orderIdStr);
		}, BROADCAST_TIMEOUT_MS);

		const entry = broadcastTimers.get(orderIdStr);
		if (entry) entry.timerId = timerId;
	} catch (err) {
		logger.error(
			`[Dispatch] startDispatch crashed for order ${orderIdStr}: ${err.message}`,
		);
	}
};

// ── Cancel dispatch (rider accepted the order) ───────────────────────────────
// Also emits "orderTaken" to all other candidates so they dismiss their popup
const cancelDispatch = (orderId) => {
	const orderIdStr = orderId.toString();
	const entry = broadcastTimers.get(orderIdStr);
	if (entry) {
		if (entry.timerId) clearTimeout(entry.timerId);

		// Notify all candidates that this order was taken
		if (global.io && entry.candidates) {
			for (const rider of entry.candidates) {
				const riderUserId = rider.user.toString();
				global.io.to(riderUserId).emit("orderTaken", { orderId: orderIdStr });
			}
			logger.info(
				`[Dispatch] orderTaken emitted to ${entry.candidates.length} rider(s) for order ${orderIdStr}`,
			);
		}

		broadcastTimers.delete(orderIdStr);
		logger.info(`Dispatch cancelled for order ${orderIdStr} (rider accepted)`);
	}
};

// ── Reject dispatch (rider explicitly rejects — just log it in broadcast mode)
const rejectDispatch = async (orderId, riderUserId) => {
	const orderIdStr = orderId.toString();
	logger.info(
		`Rider ${riderUserId} rejected dispatch for order ${orderIdStr} (broadcast mode — no queue advancement needed)`,
	);
};

// ── Retry dispatch (vendor requests another round of broadcast) ──────────────
const retryDispatch = async (orderId, vendorId) => {
	const order = await Order.findById(orderId).populate(
		"vendor",
		"name location zone",
	);
	if (!order) throw new Error("Order not found");

	if ((order.vendor._id ?? order.vendor).toString() !== vendorId) {
		throw new Error("You can only retry dispatch for your own orders");
	}

	// Only allow retry if still looking for a rider
	if (order.status !== ORDER_STATUS.RIDING || order.subStatus !== ORDER_SUB_STATUS.LOOKING_FOR_RIDER) {
		throw new Error("Order is not in looking-for-rider status");
	}

	const vendorLocation = order.vendor?.location;

	// Re-resolve zone
	let dispatchZone = order.zone;
	if (!dispatchZone || dispatchZone === "Other") {
		const { identifyZone } = require("../utils/delivery");
		const vendorAddress = order.vendor?.location?.address || "";
		dispatchZone = identifyZone(vendorAddress, order.vendor?.zone);
		logger.info(
			`[retryDispatch] Zone re-resolved: "${dispatchZone}" (was "${order.zone}") for order ${orderId}`,
		);
	}

	logger.info(
		`[retryDispatch] Vendor ${vendorId} retrying dispatch for order ${orderId} zone="${dispatchZone}"`,
	);

	await startDispatch(order._id, vendorLocation, dispatchZone);
};

// ── Notify vendor that no riders are available ───────────────────────────────
const _notifyNoRiders = async (orderIdStr) => {
	try {
		const order = await Order.findById(orderIdStr)
			.select("vendor")
			.lean();
		if (!order || !order.vendor) return;
		// order.vendor is VendorProfile._id — which matches the socket room
		const vendorProfileId = order.vendor.toString();
		if (global.io) {
			global.io.to(vendorProfileId).emit("noRidersAvailable", {
				orderId: orderIdStr,
				message: "No riders are currently available for this order.",
			});
			logger.info(`[Dispatch] noRidersAvailable emitted to vendor ${vendorProfileId} for order ${orderIdStr}`);
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

	// Restart broadcast dispatch so new riders can be found
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
		`[riderMarkArrived] START orderId=${orderId} riderId=${riderId} riderIdType=${typeof riderId}`,
	);

	const riderIdStr = riderId.toString();

	// 1. Get current order
	const existingOrder = await Order.findById(orderId);

	if (!existingOrder) {
		logger.warn(`[riderMarkArrived] ORDER NOT FOUND orderId=${orderId}`);
		throw new Error("Order not found");
	}

	logger.info(
		`[riderMarkArrived] ORDER STATE status=${existingOrder.status} subStatus=${existingOrder.subStatus} order.rider=${existingOrder.rider} riderIdStr=${riderIdStr} riderMatch=${existingOrder.rider?.toString() === riderIdStr}`,
	);

	// 2. Validate rider assignment
	if (!existingOrder.rider || existingOrder.rider.toString() !== riderIdStr) {
		logger.warn(
			`[riderMarkArrived] RIDER MISMATCH order.rider=${existingOrder.rider} incoming=${riderIdStr}`,
		);
		throw new Error("You are not assigned to this order");
	}

	// 3. Validate order status
	if (existingOrder.status !== ORDER_STATUS.RIDING) {
		logger.warn(
			`[riderMarkArrived] WRONG STATUS expected=riding actual=${existingOrder.status}`,
		);
		throw new Error("Order is not in riding status");
	}

	const ALLOWED_PRE_ARRIVAL_STATES = [
		ORDER_SUB_STATUS.RIDER_ASSIGNED,
		ORDER_SUB_STATUS.PICKED_UP,
		ORDER_SUB_STATUS.ON_THE_WAY,
	];

	// 4. Idempotent check
	if (existingOrder.subStatus === ORDER_SUB_STATUS.RIDER_ARRIVED) {
		logger.info(`[riderMarkArrived] ALREADY ARRIVED — idempotent return`);
		return existingOrder;
	}

	// 5. Validate sub-status transition
	if (!ALLOWED_PRE_ARRIVAL_STATES.includes(existingOrder.subStatus)) {
		logger.warn(
			`[riderMarkArrived] INVALID SUBSTATUS subStatus=${existingOrder.subStatus} allowed=${JSON.stringify(
				ALLOWED_PRE_ARRIVAL_STATES,
			)}`,
		);
		throw new Error(
			`Cannot mark arrived from status: ${existingOrder.subStatus}`,
		);
	}

	logger.info(`[riderMarkArrived] ALL CHECKS PASSED — firing atomic update`);

	// 6. Atomic update
	const order = await Order.findOneAndUpdate(
		{
			_id: orderId,
			rider: riderIdStr,
			status: ORDER_STATUS.RIDING,
			subStatus: { $in: ALLOWED_PRE_ARRIVAL_STATES },
		},
		{ $set: { subStatus: ORDER_SUB_STATUS.RIDER_ARRIVED } },
		{ new: true },
	);

	if (!order) {
		const debugOrder = await Order.findById(orderId);

		logger.error(
			`[riderMarkArrived] ATOMIC UPDATE FAILED — post-failure state: status=${debugOrder?.status} subStatus=${debugOrder?.subStatus} order.rider=${debugOrder?.rider} riderIdStr=${riderIdStr} riderMatch=${debugOrder?.rider?.toString() === riderIdStr}`,
		);

		throw new Error(
			"Failed to update status — invalid state transition or race condition",
		);
	}

	logger.info(`Order updated successfully — ${orderId}`);

	// 7. Socket updates (safe)
	try {
		if (global.io) {
			const payload = {
				orderId: order._id.toString(),
				status: order.status,
				subStatus: order.subStatus,
			};

			const rooms = [order.customer?.toString(), riderIdStr].filter(Boolean);

			rooms.forEach((room) => {
				global.io.to(room).emit("orderUpdate", payload);
			});
		}
	} catch (err) {
		logger.warn(`[riderMarkArrived] Socket error: ${err.message}`);
	}

	// 8. Notifications (safe failure handling)
	try {
		if (order.customer) {
			await notificationService.notifyCustomerRiderArrived(
				order.customer.toString(),
				order,
			);
		}
	} catch (err) {
		logger.warn(`[riderMarkArrived] Notification error: ${err.message}`);
	}

	return order;
};
module.exports = {
	startDispatch,
	cancelDispatch,
	rejectDispatch,
	retryDispatch,
	riderDeclineOrder,
	getAvailableRiderRequests,
	getCurrentRiderOrder,
	getRiderCompletedOrdersToday,
	getRiderOrders,
	riderMarkOnTheWay,
	riderMarkArrived,
};
