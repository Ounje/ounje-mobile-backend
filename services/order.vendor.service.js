const mongoose = require("mongoose");
const { Order, VendorProfile } = require("../models");
const orderService = require("./order.service");
const notificationService = require("./notification.service");
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

	order.status = ORDER_STATUS.DECLINED;
	order.subStatus = ORDER_SUB_STATUS.DECLINED;
	order.declinedAt = new Date();
	order.declinedBy = vendorId;
	order.declineReason = reason;
	order.declineNote = note || null;

	await order.save();

	try {
		await notificationService.notifyCustomerOrderDeclined(
			order.customer,
			order,
			{ reason: getDeclineReasonText(reason), note },
		);
		logger.info(
			`Order ${orderId} declined by vendor ${vendorId} with reason: ${reason}`,
		);
	} catch (error) {
		logger.error(`Failed to send decline notification: ${error.message}`);
	}

	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderDeclined", {
			orderId: order._id,
			vendorName: order.vendor.name,
			reason: getDeclineReasonText(reason),
			note,
			timestamp: order.declinedAt,
		});
	}

	return order;
};

const vendorAcceptOrder = async (orderId, vendorId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.vendor.toString() !== vendorId) {
		throw new Error("You can only accept orders from your restaurant");
	}

	if (order.status !== ORDER_STATUS.CONFIRMING) {
		throw new Error("Order is no longer in confirming status");
	}

	// NOTE: We update the status cleanly then pass it back to the core service
	// so that the core service can handle the side effect (broadcasting to Riders + socket).
	const updatedOrder = await orderService.updateOrderStatus(
		orderId,
		ORDER_STATUS.PENDING,
		ORDER_SUB_STATUS.LOOKING_FOR_RIDER
	);

	try {
		await notificationService.notifyCustomerOrderAccepted(
			updatedOrder.customer,
			updatedOrder,
		);
		logger.info(`Order ${orderId} accepted by vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send acceptance notification: ${error.message}`);
	}

	return updatedOrder;
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

const getVendorOrders = async (userId, query = {}) => {
	const { status } = query;

	const vendor = await VendorProfile.findOne({ owner: userId });
	if (!vendor) {
		throw new Error("Vendor profile not found for this user");
	}

	const filter = { vendor: vendor._id };

	if (status) {
		if (status === "active") {
			filter.status = {
				$in: [
					ORDER_STATUS.CONFIRMING,
					ORDER_STATUS.PENDING,
					ORDER_STATUS.RIDING,
				],
			};
		} else if (status === "completed") {
			filter.status = ORDER_STATUS.DELIVERED;
		} else if (status === "cancelled") {
			filter.status = { $in: [ORDER_STATUS.CANCELLED, ORDER_STATUS.DECLINED] };
		} else {
			filter.status = status;
		}
	}

	const orders = await Order.find(filter)
		.populate("customer", "name address phone")
		.populate("rider", "name phone")
		.populate("items.item")
		.sort({ createdAt: -1 });

	return orders;
};

const vendorGetCustomerOrderDetails = async (orderId, vendorId) => {
	const vendor = await VendorProfile.findOne({ owner: vendorId });
	if (!vendor) throw new Error("Vendor profile not found");

	const order = await Order.findOne({
		_id: orderId,
		vendor: vendor._id,
	})
		.populate("customer", "name")
		.populate({
			path: "items.item",
			select: "category subCategory name basePrice price",
		});

	if (!order) throw new Error("Order not found");

	const itemsList = order.items.map((orderItem) => {
		let itemName = null;

		if (orderItem.itemType === "FoodItem" && orderItem.item) {
			for (const subCat of orderItem.item.subCategory || []) {
				const found = subCat.items.find(
					(i) => i._id.toString() === orderItem.subCategoryItemId?.toString(),
				);
				if (found) {
					itemName = found.name;
					break;
				}
			}
		} else if (
			orderItem.itemType === "Combo" ||
			orderItem.itemType === "Plate"
		) {
			itemName = orderItem.item?.name || null;
		}

		const formattedItem = {
			itemType: orderItem.itemType,
			itemName,
			quantity: orderItem.quantity,
			price: orderItem.price,
			totalPrice: orderItem.price * orderItem.quantity,
			notes: orderItem.notes || null,
		};

		if (orderItem.itemType === "Combo") {
			formattedItem.comboSelections = orderItem.comboSelections || [];
		}

		return formattedItem;
	});

	return {
		customerName: order.customer.name,
		totalAmount: order.totalPrice,
		deliveryFee: order.deliveryFee,
		grandTotal: order.totalPrice + order.deliveryFee,
		status: order.status,
		subStatus: order.subStatus,
		deliveryAddress: order.deliveryAddress,
		items: itemsList,
	};
};

module.exports = {
	getDeclineReasonText,
	declineOrder,
	vendorAcceptOrder,
	getDeclineStats,
	getVendorOrders,
	vendorGetCustomerOrderDetails,
};
