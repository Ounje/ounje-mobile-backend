const {
	Order,
	VendorProfile,
	Combo,
	FoodItem,
	Plate,
	Customer,
	RiderProfile,
} = require("../models");
const { calculateOunjeFee, identifyZone } = require("../utils/delivery");
const crypto = require("crypto");
const { sendPushNotification } = require("./push.notification.service");
const ledgerService = require("./ledger.service");
const notificationService = require("./notification.service");
const { ORDER_STATUS, ORDER_SUB_STATUS } = require("../utils/constants");
const { generateOrderNumber } = require("../utils/orderNumber");
const logger = require("../utils/logger");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

// ── Rank thresholds ───────────────────────────────────────────────────────────
const calculateRiderRank = (totalDeliveries) => {
	if (totalDeliveries >= 200) return "Platinum Rider";
	if (totalDeliveries >= 100) return "Gold Rider";
	if (totalDeliveries >= 50) return "Silver Rider";
	if (totalDeliveries >= 10) return "Bronze Rider";
	return "New Rider";
};

// --- Helpers ---

const _emitOrderUpdate = (customerId, payload) => {
	try {
		if (global.io) {
			global.io.to(customerId.toString()).emit("orderUpdate", payload);
			logger.info(`Real-time update sent to Customer ${customerId}`);
		}
	} catch (error) {
		logger.error(
			`Failed to emit socket update to Customer ${customerId}: ${error.message}`,
		);
	}
};

const generateNumericOtp = (length = 6) => {
	let otp = "";
	for (let i = 0; i < length; i++) otp += crypto.randomInt(0, 10).toString();
	return otp;
};

const hashOtp = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

const findNearbyRiders = async (vendorLocation, orderId) => {
	try {
		const nearbyRiders = await RiderProfile.find({
			status: "available",
			isActive: true,
			currentLocation: {
				$near: {
					$geometry: vendorLocation,
					$maxDistance: 3000,
				},
			},
		});

		if (global.io && nearbyRiders.length > 0) {
			nearbyRiders.forEach((rider) => {
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

// --- Core Service Methods ---

const _calculateAndValidateItemPrice = async (item, models) => {
	const { itemId, itemType, subCategoryItemId, comboSelections } = item;
	const ProductModel = models[itemType];
	let itemPrice;
	let validatedComboSelections = undefined;
	let finalSubCatId = subCategoryItemId;
	let actualItemId = itemId;

	if (itemType === "FoodItem") {
		let product = await ProductModel.findById(actualItemId)
			.select("subCategory isAvailable name price")
			.lean();

		if (!product) {
			product = await ProductModel.findOne({
				"subCategory.items._id": actualItemId,
			})
				.select("subCategory isAvailable name price")
				.lean();

			if (product) {
				finalSubCatId = actualItemId;
				actualItemId = product._id;
			}
		}

		if (!product)
			throw new AppError(
				`FoodItem or specific option with ID ${itemId} not found`,
				404,
			);

		if (!product.isAvailable)
			throw new AppError(`FoodItem package is not available`, 400);

		let isFlatItem = false;

		if (!finalSubCatId) {
			let totalOptions = 0;
			let onlyOptionId = null;

			if (product.subCategory) {
				for (const subCat of product.subCategory) {
					totalOptions += subCat.items.length;
					if (subCat.items.length > 0) {
						onlyOptionId = subCat.items[0]._id;
					}
				}
			}

			if (totalOptions === 1) {
				finalSubCatId = onlyOptionId;
			} else if (totalOptions === 0 && product.price !== undefined) {
				isFlatItem = true;
			} else if (totalOptions === 0) {
				throw new AppError(
					`The FoodItem package "${product.name || itemId}" has no selectable options configured and cannot be ordered.`,
					400,
				);
			} else {
				throw new AppError(
					`You passed the parent FoodItem ID, but this item has ${totalOptions} options (e.g., Jollof, Fried). Please pass the specific option's ID inside 'itemId' instead.`,
					400,
				);
			}
		}

		if (isFlatItem) {
			itemPrice = product.price;
			finalSubCatId = null;
		} else {
			if (!mongoose.isValidObjectId(finalSubCatId))
				throw new AppError(`Invalid subCategoryItemId: ${finalSubCatId}`, 400);

			let foundItem = null;
			for (const subCat of product.subCategory) {
				const match = subCat.items.find(
					(i) => i._id.toString() === finalSubCatId.toString(),
				);
				if (match) {
					foundItem = match;
					break;
				}
			}

			if (!foundItem)
				throw new AppError(
					`Subcategory item with ID ${finalSubCatId} not found in FoodItem`,
					404,
				);

			if (!foundItem.isAvailable)
				throw new AppError(`Item "${foundItem.name}" is not available`, 400);

			itemPrice = foundItem.price;
		}
	} else if (itemType === "Combo") {
		const product = await ProductModel.findById(actualItemId)
			.select("basePrice name selections")
			.lean();

		if (!product)
			throw new AppError(`Combo with ID ${actualItemId} not found`, 404);

		itemPrice = product.basePrice;

		if (product.selections && product.selections.length > 0) {
			const userSelections = comboSelections || [];
			validatedComboSelections = [];
			const unmatchedUserSelections = [...userSelections];

			for (const group of product.selections) {
				const matchedItemsInGroup = [];
				let totalGroupQuantity = 0;

				for (let i = unmatchedUserSelections.length - 1; i >= 0; i--) {
					const uItemId = unmatchedUserSelections[i];
					const uIdStr = uItemId?.itemId
						? uItemId.itemId.toString()
						: uItemId?.toString() || "";
					const uQuantity = Number(uItemId?.quantity) || 1;

					const foundItem = group.items.find(
						(item) => item.item.toString() === uIdStr,
					);

					if (foundItem) {
						if (foundItem.isAvailable === false) {
							throw new AppError(
								`Option "${foundItem.name}" is currently unavailable in "${group.label}"`,
								400,
							);
						}

						const existingMatch = matchedItemsInGroup.find(
							(m) => m.item.toString() === uIdStr,
						);
						if (existingMatch) {
							existingMatch.quantitySelected += uQuantity;
						} else {
							matchedItemsInGroup.push({
								...foundItem,
								quantitySelected: uQuantity,
							});
						}

						totalGroupQuantity += uQuantity;
						unmatchedUserSelections.splice(i, 1);
					}
				}

				if (group.required && totalGroupQuantity === 0) {
					throw new AppError(
						`Selection from "${group.label}" is required for combo "${product.name}"`,
						400,
					);
				}

				if (totalGroupQuantity > group.maxSelection) {
					throw new AppError(
						`You can only select up to ${group.maxSelection} items from "${group.label}"`,
						400,
					);
				}

				if (matchedItemsInGroup.length > 0) {
					const validItems = [];
					for (const matchedItem of matchedItemsInGroup) {
						validItems.push({
							itemId: matchedItem.item,
							name: matchedItem.name,
							price: matchedItem.price || 0,
							quantity: matchedItem.quantitySelected,
						});
						itemPrice +=
							(matchedItem.price || 0) * matchedItem.quantitySelected;
					}

					validatedComboSelections.push({
						groupId: group._id,
						groupName: group.label,
						items: validItems,
					});
				}
			}

			if (unmatchedUserSelections.length > 0) {
				throw new AppError(
					`Some selected items are not valid options for the combo "${product.name}"`,
					400,
				);
			}
		}
	} else if (itemType === "Plate") {
		const product = await ProductModel.findById(actualItemId)
			.select("price name")
			.lean();

		if (!product)
			throw new AppError(`Plate with ID ${actualItemId} not found`, 404);

		itemPrice = product.price;
	}

	if (itemPrice === undefined || isNaN(itemPrice)) {
		throw new AppError(
			`Cannot determine price for ${itemType} with ID ${actualItemId}`,
			400,
		);
	}

	return {
		itemPrice,
		validatedComboSelections,
		actualItemId,
		finalSubCatId,
	};
};

const createOrder = async (userId, data) => {
	const { items, vendorId, deliveryAddress, deliveryLatitude, deliveryLongitude } = data;

	if (!mongoose.isValidObjectId(vendorId)) {
		throw new Error(`Invalid Vendor ID: ${vendorId}`);
	}

	if (!items || items.length === 0) {
		throw new Error("No items in the order.");
	}

	// 1. Fetch Vendor (needed before zone identification)
	const vendor = await VendorProfile.findById(vendorId);
	if (!vendor) throw new Error("Vendor not found");
	if (!vendor.location || !vendor.location.coordinates) {
		throw new Error("Vendor has no location set");
	}
	const vendorAddress = vendor.location.address;
	if (!vendorAddress) {
		throw new Error("Vendor address is missing");
	}

	// 2. Identify Zone from vendor address (where rider picks up — not customer delivery address)
	const orderZone = identifyZone(vendorAddress);

	// 3. Calculate Delivery Fee
	const fee = await calculateOunjeFee(vendorAddress, deliveryAddress);

	// 4. Build Order Items
	let itemsTotalPrice = 0;
	const orderItems = [];
	const models = { FoodItem, Combo, Plate };

	for (const item of items) {
		const {
			itemId,
			itemType,
			quantity = 1,
			notes,
			subCategoryItemId,
			comboSelections,
		} = item;

		if (!mongoose.isValidObjectId(itemId)) {
			throw new AppError(`Invalid Item ID: ${itemId}`, 400);
		}

		if (!models[itemType]) {
			throw new AppError(`Invalid itemType: ${itemType}`, 400);
		}

		const { itemPrice, validatedComboSelections, actualItemId, finalSubCatId } =
			await _calculateAndValidateItemPrice(item, models);

		itemsTotalPrice += itemPrice * quantity;

		const orderItemData = {
			itemType,
			item: actualItemId,
			quantity,
			price: itemPrice,
			notes,
		};

		if (finalSubCatId) {
			orderItemData.subCategoryItemId = finalSubCatId;
		} else {
			orderItemData.subCategoryItemId = null;
		}

		if (itemType === "Combo") {
			orderItemData.comboSelections = validatedComboSelections;
		}

		orderItems.push(orderItemData);
	}

	// 5. Lookup Customer
	const customer = await Customer.findOne({ user: userId });
	if (!customer) throw new Error("Customer profile not found");

	// 6. Calculate Service Fee (10% of food total) and vendor net earning
	const serviceFee = Math.round(itemsTotalPrice * 0.10);

	const COMMISSION_RATES = { basic: 0.05, growth: 0.10, premium: 0.15 };
	const commissionRate = COMMISSION_RATES[vendor.tier] ?? 0.10;
	const vendorEarning = Math.round(itemsTotalPrice * (1 - commissionRate));

	// 6b. Resolve delivery coordinates
	let finalDeliveryLat = deliveryLatitude ?? null;
	let finalDeliveryLng = deliveryLongitude ?? null;
	if ((finalDeliveryLat === null || finalDeliveryLng === null) && customer.savedAddresses?.length > 0) {
		const matched =
			customer.savedAddresses.find(
				(a) =>
					a.address &&
					deliveryAddress &&
					a.address.toLowerCase().trim() === deliveryAddress.toLowerCase().trim(),
			) || customer.savedAddresses[0];
		if (matched?.coordinates?.length === 2) {
			finalDeliveryLng = matched.coordinates[0];
			finalDeliveryLat = matched.coordinates[1];
		}
	}

	// 7. Create Order
	const order = await Order.create({
		customer: customer._id,
		vendor: vendorId,
		items: orderItems,
		totalPrice: itemsTotalPrice + fee + serviceFee,
		deliveryFee: fee,
		serviceFee,
		foodTotal: itemsTotalPrice,
		vendorEarning,
		deliveryAddress,
		deliveryLatitude: finalDeliveryLat,
		deliveryLongitude: finalDeliveryLng,
		status: ORDER_STATUS.CONFIRMING,
		subStatus: ORDER_SUB_STATUS.CONFIRMING,
		zone: orderZone,
	});
	order.orderNumber = await generateOrderNumber(order._id);
	await order.save();

	// 8. Notify vendor
	try {
		await notificationService.notifyNewOrder(vendorId, order);
		logger.info(`New order notification sent to vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send new order notification: ${error.message}`);
	}

	// 9. Real-time socket ping to vendor — emitted by payment handlers AFTER payment
	// is confirmed, so we intentionally do NOT emit here. Unpaid orders must not
	// appear in the vendor dashboard.

	return order;
};

/**
 * Calculate totalPrice, deliveryFee, serviceFee for a cart WITHOUT creating an order.
 * Used by the payment initiation endpoint so the frontend can display the correct
 * amount before the user pays.
 */
const estimateOrderPrice = async (cartData) => {
	const { items, vendorId, deliveryAddress } = cartData;

	if (!mongoose.isValidObjectId(vendorId)) throw new Error(`Invalid Vendor ID: ${vendorId}`);
	if (!items || items.length === 0) throw new Error("No items in the cart.");

	const vendor = await VendorProfile.findById(vendorId);
	if (!vendor) throw new Error("Vendor not found");
	if (!vendor.location?.address) throw new Error("Vendor address is missing");

	const fee = await calculateOunjeFee(vendor.location.address, deliveryAddress);
	const models = { FoodItem, Combo, Plate };

	let itemsTotalPrice = 0;
	for (const item of items) {
		const { itemPrice } = await _calculateAndValidateItemPrice(item, models);
		itemsTotalPrice += itemPrice * (item.quantity ?? 1);
	}

	const serviceFee = Math.round(itemsTotalPrice * 0.10);
	const COMMISSION_RATES = { basic: 0.05, growth: 0.10, premium: 0.15 };
	const commissionRate = COMMISSION_RATES[vendor.tier] ?? 0.10;
	const vendorEarning = Math.round(itemsTotalPrice * (1 - commissionRate));

	return {
		foodTotal: itemsTotalPrice,
		deliveryFee: fee,
		serviceFee,
		totalPrice: itemsTotalPrice + fee + serviceFee,
		vendorEarning,
	};
};

const updateOrderStatus = async (orderId, status, subStatus) => {
	const order = await Order.findById(orderId).populate({
		path: "customer",
		populate: { path: "user", select: "fcmToken" }
	});
	if (!order) throw new Error("Order not found");

	order.status = status;
	order.subStatus = subStatus || "";
	await order.save();

	_emitOrderUpdate(order.customer._id, {
		orderId: order._id,
		status: order.status,
		subStatus: order.subStatus,
	});

	const fcmToken = order.customer && order.customer.user ? order.customer.user.fcmToken : null;
	if (fcmToken) {
		const title = `Order Update: ${status}`;
		const body = subStatus || `Your order is now ${status}`;
		await sendPushNotification(fcmToken, title, body);
	}

	// CHANGED: was ORDER_STATUS.RIDING, now ORDER_STATUS.PACKAGING to match new flow
	if (
		status === ORDER_STATUS.PACKAGING &&
		subStatus === ORDER_SUB_STATUS.LOOKING_FOR_RIDER
	) {
		const vendor = await VendorProfile.findById(order.vendor);
		await findNearbyRiders(vendor.location, order._id);
	}

	return order;
};

const sendDeliveryOtp = async (order) => {
	if (!order) throw new Error("Order required");
	const customer = await Customer.findById(order.customer);
	if (!customer) throw new Error("Customer not found");

	const otp = generateNumericOtp(
		parseInt(process.env.DELIVERY_OTP_LENGTH || 6),
	);
	const otpHash = hashOtp(otp);
	const duration = parseInt(process.env.DELIVERY_OTP_DURATION || 1440); // 24 hours

	order.deliveryOtpCode = otp;
	logger.info(`Generated OTP for order ${order._id}: ${otp}`);
	order.deliveryOtpHash = otpHash;
	order.deliveryOtpSentAt = new Date();
	order.deliveryOtpExpiresAt = new Date(Date.now() + duration * 60 * 1000);
	await order.save();

	try {
		if (global.io) {
			global.io.to(order.customer.toString()).emit("delivery-otp", {
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

	if (new Date() > new Date(order.deliveryOtpExpiresAt))
		throw new Error("OTP expired");

	const providedHash = hashOtp(otp);
	if (providedHash !== order.deliveryOtpHash) throw new Error("Invalid OTP");

	order.status = ORDER_STATUS.DELIVERED;
	order.subStatus = ORDER_SUB_STATUS.DELIVERED;
	order.deliveryConfirmedAt = new Date();
	order.deliveryConfirmedBy = riderId;

	order.deliveryOtpCode = null;
	order.deliveryOtpHash = null;
	order.deliveryOtpExpiresAt = null;
	order.deliveryOtpSentAt = null;

	await ledgerService.releaseRiderFee(order.rider, order._id);

	// Release vendor's held meal earnings → availableBalance (withdrawable)
	try {
		await ledgerService.releaseVendorAmount(order.vendor, order._id);
	} catch (vendorLedgerErr) {
		logger.error(`Failed to release vendor amount for order ${order._id}: ${vendorLedgerErr.message}`);
		// Non-blocking — delivery still completes
	}

	await order.save();

	try {
		if (order.rider) {
			const updatedProfile = await RiderProfile.findByIdAndUpdate(
				order.rider,
				{ $inc: { totalDeliveries: 1 } },
				{ new: true, select: "totalDeliveries" },
			);
			if (updatedProfile) {
				const rank = calculateRiderRank(updatedProfile.totalDeliveries);
				await RiderProfile.findByIdAndUpdate(order.rider, { rank });
			}
		}
	} catch (err) {
		logger.error(
			`Stats update failed for order ${order._id}: ${err.message}`,
		);
	}

	return { success: true };
};

const acceptOrder = async (orderId, riderId) => {
	// Prevent a rider from accepting a new order while they have an active delivery
	const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
	const activeRide = await Order.findOne({
		rider: riderId,
		status: ORDER_STATUS.RIDING,
		subStatus: { $in: [ORDER_SUB_STATUS.RIDER_ASSIGNED, ORDER_SUB_STATUS.PICKED_UP, ORDER_SUB_STATUS.ON_THE_WAY] },
		updatedAt: { $gte: twoHoursAgo },
	});
	if (activeRide) {
		throw new Error("You already have an active delivery. Complete or decline it first.");
	}

	const order = await Order.findOneAndUpdate(
		{
			_id: orderId,
			$or: [
				// Primary state: vendor marked ready → rider search triggered
				{
					status: ORDER_STATUS.RIDING,
					subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
					rider: null,
				},
				// Fallback: order packaged but rider search not yet complete
				{
					status: ORDER_STATUS.PACKAGING,
					subStatus: ORDER_SUB_STATUS.PACKAGED,
					rider: null,
				},
				{
					status: ORDER_STATUS.PACKAGING,
					subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
					rider: null,
				},
				{
					status: ORDER_STATUS.CONFIRMING,
					subStatus: ORDER_SUB_STATUS.PACKAGED,
					rider: null,
				},
			],
		},
		{
			$set: {
				rider: riderId,
				status: ORDER_STATUS.RIDING,
				subStatus: ORDER_SUB_STATUS.RIDER_ASSIGNED,
			},
		},
		{ new: true },
	).populate("rider", "name");

	if (!order) {
		const existingOrder = await Order.findById(orderId);
		if (!existingOrder) throw new Error("Order not found");
		throw new Error(
			"Order is no longer available. Another rider may have accepted it.",
		);
	}

	try {
		const riderName = order.rider?.name || "A rider";
		await notificationService.notifyCustomerRiderAssigned(
			order.customer,
			order,
			riderName,
		);
		logger.info(
			`Rider assignment notification sent to customer ${order.customer}`,
		);
	} catch (error) {
		logger.error(
			`Failed to send rider assignment notification: ${error.message}`,
		);
	}

	_emitOrderUpdate(order.customer, {
		orderId: order._id,
		status: order.status,
		subStatus: order.subStatus,
		message: "A rider has accepted your order and is on the way!",
	});

	// Hold delivery fee in escrow so it shows in the rider's wallet immediately
	try {
		if (order.deliveryFee > 0) {
			await ledgerService.holdRiderFee(riderId, order.deliveryFee, order._id);
		}
	} catch (ledgerErr) {
		logger.error(`Failed to hold rider fee for order ${orderId}: ${ledgerErr.message}`);
		// Non-blocking — order accept still succeeds
	}

	logger.info(`Rider ${riderId} accepted Order ${orderId}`);

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

	// OTP was already generated at payment time — re-emit to remind the customer.
	// Fall back to generating a new one only for legacy orders that predate this change.
	if (order.deliveryOtpCode && order.deliveryOtpExpiresAt > new Date()) {
		try {
			if (global.io) {
				global.io.to(order.customer.toString()).emit("delivery-otp", {
					orderId: order._id,
					customerId: order.customer,
					otp: order.deliveryOtpCode,
					expiresAt: order.deliveryOtpExpiresAt,
				});
			}
		} catch (err) {
			logger.error(`Failed to re-emit delivery OTP at pickup: ${err.message}`);
		}
	} else {
		await sendDeliveryOtp(order);
	}

	try {
		await notificationService.notifyCustomerOrderPickedUp(
			order.customer,
			order,
		);
		logger.info(
			`Order picked up notification sent to customer ${order.customer}`,
		);
	} catch (error) {
		logger.error(`Failed to send pickup notification: ${error.message}`);
	}

	return order;
};

const completeDelivery = async (orderId, riderId, otp) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.rider.toString() !== riderId) {
		throw new Error("Not assigned to you");
	}

	await verifyDeliveryOtp(order, otp, riderId);

	try {
		await notificationService.notifyCustomerDeliveryComplete(
			order.customer,
			order,
		);
		logger.info(
			`Delivery completion notification sent to customer ${order.customer}`,
		);
	} catch (error) {
		logger.error(
			`Failed to send delivery completion notification: ${error.message}`,
		);
	}

	_emitOrderUpdate(order.customer, {
		orderId: order._id,
		status: ORDER_STATUS.DELIVERED,
		subStatus: ORDER_SUB_STATUS.DELIVERED,
		message: "Delivery confirmed! Enjoy your meal.",
	});

	// Notify vendor so their order detail updates to "Delivered"
	if (global.io && order.vendor) {
		global.io.to(order.vendor.toString()).emit("orderUpdate", {
			orderId: order._id,
			status: ORDER_STATUS.DELIVERED,
			subStatus: ORDER_SUB_STATUS.DELIVERED,
		});
		logger.info(`Delivered status emitted to vendor ${order.vendor}`);
	}

	logger.info(`Order ${orderId} delivered by Rider ${riderId}`);

	return order;
};

const cancelOrder = async (orderId, customerId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.customer.toString() !== customerId) {
		throw new Error("You can only cancel your own orders");
	}

	if (order.status !== ORDER_STATUS.CONFIRMING) {
		throw new Error("You can only cancel orders before vendor accepts");
	}

	order.status = ORDER_STATUS.CANCELLED;
	order.subStatus = ORDER_SUB_STATUS.CANCELLED;
	order.cancelledAt = new Date();
	order.cancelledBy = customerId;
	order.cancellationCategory = "customer";

	await order.save();

	try {
		await notificationService.notifyOrderCancelled(order.vendor, order);
		logger.info(
			`Order ${orderId} cancelled by customer ${customerId}, vendor ${order.vendor} notified`,
		);
	} catch (error) {
		logger.error(`Failed to send cancellation notification: ${error.message}`);
	}

	return order;
};

// NEW: vendor marks food as packaged/ready — triggers rider search
const vendorMarkReady = async (orderId, vendorId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.vendor.toString() !== vendorId) {
		throw new Error("You can only update orders from your restaurant");
	}

	if (
    order.status !== ORDER_STATUS.CONFIRMING &&
    order.status !== ORDER_STATUS.PACKAGING
	) {
		throw new Error("Order cannot be marked as ready at this stage");
	}

	order.status = ORDER_STATUS.PACKAGING;
	order.subStatus = ORDER_SUB_STATUS.PACKAGED;
	await order.save();

	// Notify nearby riders that food is ready
	try {
		const vendor = await VendorProfile.findById(order.vendor);
		if (vendor && vendor.location) {
			await findNearbyRiders(vendor.location, order._id);
		}
	} catch (error) {
		logger.error(`Failed to notify riders: ${error.message}`);
	}

	// Notify customer food is packaged
	_emitOrderUpdate(order.customer, {
		orderId: order._id,
		status: order.status,
		subStatus: order.subStatus,
		message: "Your food is packaged and a rider is on the way!",
	});

	return order;
};

// NEW: vendor accepts order → moves to PACKAGING/CONFIRMED
const vendorAcceptOrder = async (orderId, vendorId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	if (order.vendor.toString() !== vendorId) {
		throw new Error("You can only accept orders from your restaurant");
	}

	if (order.status !== ORDER_STATUS.CONFIRMING) {
		throw new Error("Order is no longer in confirming status");
	}

	order.status = ORDER_STATUS.CONFIRMING;
	order.subStatus = ORDER_SUB_STATUS.CONFIRMED;
	await order.save();

	try {
		await notificationService.notifyCustomerOrderAccepted(
			order.customer,
			order,
		);
		logger.info(`Order ${orderId} accepted by vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send acceptance notification: ${error.message}`);
	}

	if (global.io) {
		global.io.to(order.customer.toString()).emit("orderAccepted", {
			orderId: order._id,
			status: order.status,
			subStatus: order.subStatus,
		});
	}

	return order;
};

const resendDeliveryOtp = async (orderId, userId, role) => {
	const order = await Order.findById(orderId);
	if (!order) throw new Error("Order not found");

	// Allow both customer and rider to trigger resend
	if (role === "rider") {
		const { RiderProfile } = require("../models");
		const rider = await RiderProfile.findOne({ user: userId });
		if (!rider || order.rider.toString() !== rider._id.toString()) {
			throw new Error("You are not the assigned rider for this order");
		}
	} else if (role === "customer") {
		const { Customer } = require("../models");
		const customer = await Customer.findOne({ user: userId });
		if (!customer || order.customer.toString() !== customer._id.toString()) {
			throw new Error("You are not the customer for this order");
		}
	} else {
		throw new Error("Only customer or rider can resend OTP");
	}

	if (order.paymentStatus !== "paid") {
		throw new Error("Order must be paid before resending OTP");
	}

	if (order.status === ORDER_STATUS.DELIVERED || order.status === ORDER_STATUS.CANCELLED) {
		throw new Error("Cannot resend OTP for a completed or cancelled order");
	}

	await sendDeliveryOtp(order);
	return { success: true, message: "OTP resent to customer" };
};

module.exports = {
	createOrder,
	estimateOrderPrice,
	updateOrderStatus,
	sendDeliveryOtp,
	resendDeliveryOtp,
	verifyDeliveryOtp,
	acceptOrder,
	pickUpOrder,
	completeDelivery,
	cancelOrder,
	vendorAcceptOrder,
	vendorMarkReady,
	generateNumericOtp,
	hashOtp,
};
