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

// --- Helpers ---

/**
 * Standardize real-time order updates to customers via Socket.io
 */
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

		// If the frontend passed the specific sub-option ID as `itemId` instead of the parent FoodItem ID
		if (!product) {
			product = await ProductModel.findOne({
				"subCategory.items._id": actualItemId,
			})
				.select("subCategory isAvailable name price")
				.lean();

			if (product) {
				finalSubCatId = actualItemId; // That ID they sent was actually the specific sub-item option
				actualItemId = product._id; // Correct the parent ID for the database foreign key reference
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

		// If subCategoryItemId is not provided, check if we can auto-resolve it
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

			// Find the specific subcategory item ordered
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

				// Find which of the user's selected items belong to this group
				// We iterate backwards to safely modify the unmatched array
				for (let i = unmatchedUserSelections.length - 1; i >= 0; i--) {
					const uItemId = unmatchedUserSelections[i];
					// Support both plain string IDs and objects like { itemId, quantity } just in case
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

						// Check if we already matched this item (to merge duplicate IDs sent in array)
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
	const vendor = await VendorProfile.findById(vendorId);
	if (!vendor) throw new Error("Vendor not found");
	if (!vendor.location || !vendor.location.coordinates) {
		throw new Error("Vendor has no location set");
	}

	// 3. Calculate Fee
	const vendorAddress = vendor.location ? vendor.location.address : null;

	if (!vendorAddress) {
		throw new Error("Vendor address is missing");
	}

	const fee = await calculateOunjeFee(vendorAddress, deliveryAddress);

	// --- Updated Logic inside createOrder ---

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

		// If the itemType sent doesn't exist in our mapping, we stop early
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

	// 4. Lookup Customer document ID from User ID
	const customer = await Customer.findOne({ user: userId });
	if (!customer) throw new Error("Customer profile not found");

	// 5. Create Order
	const order = await Order.create({
		customer: customer._id,
		vendor: vendorId,
		items: orderItems,
		totalPrice: itemsTotalPrice + fee,
		deliveryFee: fee,
		deliveryAddress,
		status: ORDER_STATUS.CONFIRMING,
		subStatus: ORDER_SUB_STATUS.CONFIRMING,
		zone: orderZone,
	});
	order.orderNumber = await generateOrderNumber(order._id);
	await order.save();

	// 6. Send notification to vendor
	try {
		await notificationService.notifyNewOrder(vendorId, order);
		logger.info(`New order notification sent to vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send new order notification: ${error.message}`);
	}

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
	_emitOrderUpdate(order.customer._id, {
		orderId: order._id,
		status: order.status,
		subStatus: order.subStatus,
	});

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

			// Increment totalDeliveries for the rider
			await RiderProfile.findByIdAndUpdate(order.rider, {
				$inc: { totalDeliveries: 1 },
			});
		}
	} catch (err) {
		logger.error(
			`Auto payout or stats update failed for order ${order._id}: ${err.message}`,
		);
	}

	return { success: true };
};

// --- Core Service Methods ---

const acceptOrder = async (orderId, riderId) => {
	// Atomic update to prevent race conditions
	// Accept orders that are either PENDING or actively looking for a rider
	const order = await Order.findOneAndUpdate(
		{
			_id: orderId,
			$or: [
				{ status: ORDER_STATUS.PENDING, rider: null },
				{
					status: ORDER_STATUS.RIDING,
					subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
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
		// Double check if it was just because of status or if it doesn't exist
		const existingOrder = await Order.findById(orderId);
		if (!existingOrder) throw new Error("Order not found");

		throw new Error(
			"Order is no longer available. Another rider may have accepted it.",
		);
	}

	// Notify Customer about rider assignment
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

	// Notify Customer via Socket.io
	_emitOrderUpdate(order.customer, {
		orderId: order._id,
		status: order.status,
		subStatus: order.subStatus,
		message: "A rider has accepted your order and is on the way!",
	});
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

	// Send OTP to customer
	await sendDeliveryOtp(order);

	// Notify customer that order has been picked up
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

	// Notify customer about delivery completion
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

	// Real-time update
	_emitOrderUpdate(order.customer, {
		orderId: order._id,
		status: ORDER_STATUS.DELIVERED,
		subStatus: ORDER_SUB_STATUS.DELIVERED,
		message: "Delivery confirmed! Enjoy your meal.",
	});
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


module.exports = {
	createOrder,
	updateOrderStatus,
	sendDeliveryOtp,
	verifyDeliveryOtp,
	acceptOrder,
	pickUpOrder,
	completeDelivery,
	cancelOrder,
	generateNumericOtp,
	hashOtp,
};
