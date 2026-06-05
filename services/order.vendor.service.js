const mongoose = require("mongoose");
const { Order, VendorProfile } = require("../models");
const orderService = require("./order.service");
const notificationService = require("./notification.service");
const ledgerService = require("./ledger.service");

const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utils/constants");
const logger = require("../utils/logger");

const getDeclineReasonText = (reason) => {
	const reasonTexts = {
		vendor_out_of_stock: "Items are out of stock",
		vendor_too_busy: "We're too busy right now",
		vendor_kitchen_closed: "Kitchen is closed",
		vendor_delivery_area_not_covered: "We don't deliver to this area",
		vendor_technical_issue: "Technical issue occurred",
		vendor_item_unavailable: "Some items are unavailable",
		vendor_prep_time_too_long: "Preparation time would be too long",
		vendor_other: "Unable to fulfill order",
	};
	return reasonTexts[reason] || reason;
};

const declineOrder = async (orderId, vendorId, declineData = {}) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.vendor.toString() !== vendorId) {
		throw new Error("You can only decline orders from your restaurant");
	}

	if (order.status !== ORDER_STATUS.CONFIRMING) {
		throw new Error(
			"Order can only be declined during confirmation stage (after notification, before acceptance).",
		);
	}

	const { reason, note } = declineData;

	if (!reason) throw new Error("Decline reason is required");

	const validDeclineReasons = [
		"vendor_out_of_stock",
		"vendor_too_busy",
		"vendor_kitchen_closed",
		"vendor_delivery_area_not_covered",
		"vendor_technical_issue",
		"vendor_item_unavailable",
		"vendor_prep_time_too_long",
		"vendor_other",
	];

	if (!validDeclineReasons.includes(reason))
		throw new Error("Invalid decline reason");

	// Atomically transition the order to declined only if it is still confirming
	const updatedOrder = await Order.findOneAndUpdate(
		{ _id: orderId, status: ORDER_STATUS.CONFIRMING },
		{
			$set: {
				status: ORDER_STATUS.DECLINED,
				subStatus: ORDER_SUB_STATUS.DECLINED,
				declinedAt: new Date(),
				declinedBy: vendorId,
				declineReason: reason,
				declineNote: note || null,
			}
		},
		{ new: true }
	);

	if (!updatedOrder) {
		throw new Error("Order was already accepted, cancelled, or declined by another process.");
	}

	if (updatedOrder.paymentStatus === "paid") {
		// Atomically transition paymentStatus from paid to refunded
		const refundedOrder = await Order.findOneAndUpdate(
			{ _id: updatedOrder._id, paymentStatus: "paid" },
			{ $set: { paymentStatus: "refunded" } },
			{ new: true }
		);
		if (refundedOrder) {
			const originalPaymentMethod = updatedOrder.paymentMethod || "paystack";
			await ledgerService.creditAccount(
				updatedOrder.customer,
				"CUSTOMER",
				updatedOrder.totalPrice,
				"REFUND",
				updatedOrder._id,
				{ reason: "vendor_declined", originalPaymentMethod },
			);
			logger.info(`[REFUND] Order ${updatedOrder._id} payment refunded to O-Credit wallet`);
		}
	}

	// Always reverse vendor and rider holds on decline — the holds are created
	// by the Paystack webhook regardless of paymentStatus timing.
	// reverseVendorHold and reverseRiderFeeHold are idempotent (alreadyReversed guard).
	await ledgerService.reverseVendorHold(updatedOrder.vendor, updatedOrder._id);

	if (updatedOrder.rider) {
		await ledgerService.reverseRiderFeeHold(updatedOrder.rider, updatedOrder._id);
	}


	try {
		const vendorProfile = await VendorProfile.findById(vendorId).select("storeName").lean();
		const vendorName = vendorProfile?.storeName || "The vendor";
		await notificationService.notifyCustomerOrderDeclined(
			updatedOrder.customer,
			updatedOrder,
			vendorName,
		);
		logger.info(
			`Order ${orderId} declined by vendor ${vendorId} with reason: ${reason}`,
		);
	} catch (error) {
		logger.error(`Failed to send decline notification: ${error.message}`);
	}

	if (global.io) {
		global.io.to(updatedOrder.customer.toString()).emit("orderUpdate", {
			orderId: updatedOrder._id,
			status: updatedOrder.status,
			subStatus: updatedOrder.subStatus,
		});
		// Also notify the vendor's own socket room so their Cancelled tab updates instantly
		global.io.to(vendorId.toString()).emit("orderUpdate", {
			orderId: updatedOrder._id,
			status: updatedOrder.status,
			subStatus: updatedOrder.subStatus,
		});
	}

	return updatedOrder;
};

const vendorAcceptOrder = async (orderId, vendorId) => {
	const order = await Order.findById(orderId).populate("vendor", "name");
	if (!order) throw new Error("Order not found");

	if ((order.vendor._id ?? order.vendor).toString() !== vendorId) {
		throw new Error("You can only accept orders from your restaurant");
	}

	if (order.status !== ORDER_STATUS.CONFIRMING) {
		throw new Error("Order is no longer in confirming status");
	}

	order.status = ORDER_STATUS.CONFIRMING;
	order.subStatus = ORDER_SUB_STATUS.CONFIRMED;
	await order.save();

	// move vendor earning from hold → pending so it shows in wallet right away
	try {
		await ledgerService.pendVendorEarning(order.vendor, order._id);
	} catch (ledgerErr) {
		logger.error(
			`[WALLET] pendVendorEarning failed on accept: orderId=${orderId} err=${ledgerErr.message}`,
		);
	}

	try {
		await notificationService.notifyCustomerOrderAccepted(
			order.customer,
			order,
			order.vendor?.name || "Your vendor",
		);
		logger.info(`Order ${orderId} accepted by vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send acceptance notification: ${error.message}`);
	}

	// Notify customer that their order has been confirmed
	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
		global.io.to(vendorId.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
	}

	return order;
};

const vendorStartPreparing = async (orderId, vendorId) => {
	const order = await Order.findById(orderId).populate(
		"vendor",
		"name location",
	);
	if (!order) throw new Error("Order not found");

	if (order.vendor._id.toString() !== vendorId) {
		throw new Error("You can only update orders from your restaurant");
	}

	const allowedStatuses = [ORDER_STATUS.CONFIRMING, ORDER_STATUS.PENDING];
	if (!allowedStatuses.includes(order.status)) {
		throw new Error("Order must be confirmed before starting preparation");
	}

	order.status = ORDER_STATUS.PACKAGING;
	order.subStatus = ORDER_SUB_STATUS.PACKAGING;
	await order.save();

	// Notify customer — they see "Restaurant is preparing your order"
	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
		global.io.to(vendorId.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
	}

	// Rider search is triggered in vendorMarkReady (when order is actually packed and ready)
	logger.info(`Order ${orderId} — vendor ${vendorId} started preparing`);
	return order;
};

const vendorMarkReady = async (orderId, vendorId) => {
	const order = await Order.findById(orderId).populate(
		"vendor",
		"name location zone",
	);
	if (!order) throw new Error("Order not found");

	if (order.vendor._id.toString() !== vendorId) {
		throw new Error("You can only update orders from your restaurant");
	}

	const allowedForReady = [ORDER_STATUS.PENDING, ORDER_STATUS.PACKAGING];
	if (!allowedForReady.includes(order.status)) {
		throw new Error("Order must be in preparation before marking as ready");
	}

	order.status = ORDER_STATUS.PACKAGING;
	order.subStatus = ORDER_SUB_STATUS.PACKAGED;
	await order.save();

	// Notify customer — they see "Order is packed and ready"
	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
		global.io.to(vendorId.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
	}

	try {
		await notificationService.notifyCustomerFoodReady(order.customer, order);
		logger.info(`Order ${orderId} marked ready by vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send ready notification: ${error.message}`);
	}

	logger.info(
		`[vendorMarkReady] orderId=${orderId} | order.zone="${order.zone}" | vendorLocation=${JSON.stringify(order.vendor?.location?.coordinates)}`,
	);

	// Step 1: Always transition order to LOOKING_FOR_RIDER (guaranteed, no GPS dependency)
	try {
		await orderService.updateOrderStatus(
			orderId,
			ORDER_STATUS.RIDING,
			ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
		);
		logger.info(
			`[vendorMarkReady] Status set to RIDING/LOOKING_FOR_RIDER for order ${orderId}`,
		);
		if (global.io) {
			global.io.to(order.customer.toString()).emit("orderUpdate", {
				orderId: order._id,
				status: ORDER_STATUS.RIDING,
				subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
			});
			global.io.to(vendorId.toString()).emit("orderUpdate", {
				orderId: order._id,
				status: ORDER_STATUS.RIDING,
				subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
			});
		}
	} catch (statusError) {
		logger.error(
			`Failed to set LOOKING_FOR_RIDER status: ${statusError.message}`,
		);
	}

	// Step 2: Start sequential dispatch — one rider at a time, 60s per rider (non-blocking)
	try {
		const vendorLocation = order.vendor?.location;
		const { startDispatch } = require("./order.rider.service");

		// Re-resolve zone at dispatch time — order.zone may be "Other"/null for orders created
		// before the explicit vendor.zone field was added. Prefer vendor.zone, then address match.
		let dispatchZone = order.zone;
		if (!dispatchZone || dispatchZone === "Other") {
			const { identifyZone } = require("../utils/delivery");
			const vendorAddress = order.vendor?.location?.address || "";
			dispatchZone = identifyZone(vendorAddress, order.vendor?.zone);
			logger.info(
				`[vendorMarkReady] Zone re-resolved: "${dispatchZone}" (was "${order.zone}") for order ${orderId}`,
			);
		}

		logger.info(
			`[vendorMarkReady] Triggering startDispatch for order ${orderId} zone="${dispatchZone}"`,
		);
		await startDispatch(order._id, vendorLocation, dispatchZone);
	} catch (error) {
		logger.error(`Dispatch start failed (non-blocking): ${error.message}`);
	}

	return order;
};

const getDeclineStats = async (vendorId, filters = {}) => {
	const { startDate, endDate } = filters;
	const matchStage = {
		vendor: mongoose.Types.ObjectId(vendorId),
		status: ORDER_STATUS.DECLINED,
	};

	if (startDate && endDate) {
		matchStage.declinedAt = {
			$gte: new Date(startDate),
			$lte: new Date(endDate),
		};
	}

	const stats = await Order.aggregate([
		{ $match: matchStage },
		{ $group: { _id: "$declineReason", count: { $sum: 1 } } },
		{ $sort: { count: -1 } },
	]);

	const totalDeclines = stats.reduce((sum, item) => sum + item.count, 0);

	return {
		totalDeclines,
		byReason: stats.map((s) => ({
			reason: s._id,
			reasonText: getDeclineReasonText(s._id),
			count: s.count,
			percentage:
				totalDeclines > 0
					? ((s.count / totalDeclines) * 100).toFixed(2)
					: "0.00",
		})),
	};
};

const getVendorOrders = async (vendorProfileId, query = {}) => {
	const { status } = query;

	// Only show orders that have been paid or refunded — unpaid orders are invisible to vendor
	const filter = { vendor: vendorProfileId, paymentStatus: { $in: ["paid", "refunded"] } };

	if (status) {
		if (status === "confirming") {
			// Only unaccepted new orders — vendor hasn't acted yet (subStatus still "confirming")
			filter.status = ORDER_STATUS.CONFIRMING;
			filter.subStatus = ORDER_SUB_STATUS.CONFIRMING;
		} else if (status === "active") {
			// Orders in progress updated within the last 24 h (excludes stale test data)
			const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
			filter.updatedAt = { $gte: staleThreshold };
			filter.status = {
				$in: [
					ORDER_STATUS.CONFIRMING,
					ORDER_STATUS.PACKAGING,
					ORDER_STATUS.PENDING,
					ORDER_STATUS.RIDING,
					"assigned",
				],
			};
			// Exclude unaccepted orders (status=confirming + subStatus=confirming = still in new tab)
			filter.$nor = [
				{
					status: ORDER_STATUS.CONFIRMING,
					subStatus: ORDER_SUB_STATUS.CONFIRMING,
				},
			];
		} else if (status === "completed") {
			filter.status = ORDER_STATUS.DELIVERED;
		} else if (status === "cancelled") {
			filter.status = { $in: [ORDER_STATUS.CANCELLED, ORDER_STATUS.DECLINED] };
		} else {
			filter.status = status;
		}
	}

	const orders = await Order.find(filter)
		.populate("customer", "firstName lastName phone -_id")
		.populate({
			path: "rider",
			select: "user",
			populate: { path: "user", select: "name phone" },
		})
		.populate({ path: "items.item", select: "name comboName img imageUrl" })
		.sort({ createdAt: -1 });

	// Flatten rider.user.name → rider.name so frontend reads work unchanged
	return orders.map((order) => {
		const obj = order.toObject();
		if (obj.rider?.user) {
			obj.rider.name = obj.rider.user.name ?? null;
			obj.rider.phone = obj.rider.user.phone ?? null;
			delete obj.rider.user;
		}
		return obj;
	});
};

const vendorGetCustomerOrderDetails = async (orderId, vendorProfileId) => {
	const order = await Order.findOne({
		_id: orderId,
		vendor: vendorProfileId,
	})
		.populate("customer", "firstName lastName phone -_id")
		.populate({
			path: "rider",
			select: "user",
			populate: { path: "user", select: "name phone" },
		})
		.populate({
			path: "items.item",
			select: "category subCategory name comboName plateName basePrice price",
		});

	if (!order) throw new Error("Order not found");

	const obj = order.toObject();
	if (obj.rider?.user) {
		obj.rider.name = obj.rider.user.name ?? null;
		obj.rider.phone = obj.rider.user.phone ?? null;
		delete obj.rider.user;
	}

	// Dynamically check if a dispatch is currently active for this order
	try {
		const { isDispatchActive } = require("./order.rider.service");
		obj.dispatchActive = isDispatchActive(orderId);
	} catch (err) {
		obj.dispatchActive = false;
	}

	return obj;
};

module.exports = {
	getDeclineReasonText,
	declineOrder,
	vendorAcceptOrder,
	vendorStartPreparing,
	vendorMarkReady,
	getDeclineStats,
	getVendorOrders,
	vendorGetCustomerOrderDetails,
};
