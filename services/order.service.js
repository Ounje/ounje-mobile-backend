const {
	Order,
	VendorProfile,
	Combo,
	FoodItem,
	Plate,
	Customer,
	RiderProfile,
	Payment,
	User,
} = require("../models");
const { calculateOunjeFee, identifyZone } = require("../utils/delivery");
const { parseTime: _parseTime } = require("../utils/time");
const {
	isVendorOpenNow,
	buildClosedReason,
} = require("../utils/vendorScheduleCheck");
const calculateCustomerRank = require("../utils/customerRank");
const crypto = require("crypto");
const { sendPushNotification } = require("./push.notification.service");
const { refundTransaction } = require("./dva.service");
const ledgerService = require("./ledger.service");
const notificationService = require("./notification.service");
const EmailService = require("./email/EmailService");
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

// ── Fee calculation helper (FIX #12: extracted shared helper, no duplication) ─
const COMMISSION_RATES = { basic: 0.05, growth: 0.1, premium: 0.15 };
const SERVICE_FEE_RATE = 0.1;

const _calculateFees = (itemsTotalPrice, vendorTier) => {
	const serviceFee = Math.round(itemsTotalPrice * SERVICE_FEE_RATE);
	const commissionRate = COMMISSION_RATES[vendorTier] ?? 0.1;
	const vendorEarning = Math.round(itemsTotalPrice * (1 - commissionRate));
	return { serviceFee, vendorEarning };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// FIX #8: Removed dead `findNearbyRiders` — replaced by order.rider.service dispatch.

const _calculateAndValidateItemPrice = async (item, models) => {
	const {
		itemId,
		itemType,
		quantity = 1,
		subCategoryItemId,
		comboSelections,
	} = item;
	const ProductModel = models[itemType];
	let itemPrice;
	let resolvedName = "";
	let validatedComboSelections = undefined;
	let finalSubCatId = subCategoryItemId;
	let actualItemId = itemId;

	if (itemType === "FoodItem") {
		let product = await ProductModel.findOne({
			_id: actualItemId,
			isAvailable: true,
		})
			.select("subCategory isAvailable name price")
			.lean();

		if (!product) {
			const exists = await ProductModel.findById(actualItemId)
				.select("_id isAvailable")
				.lean();
			if (exists) {
				throw new AppError(`FoodItem package is not available`, 400);
			}
			const bySubCat = await ProductModel.findOne({
				"subCategory.items._id": actualItemId,
			})
				.select("subCategory isAvailable name price")
				.lean();

			if (bySubCat) {
				if (bySubCat.isAvailable === false)
					throw new AppError(`FoodItem package is not available`, 400);
				finalSubCatId = actualItemId;
				actualItemId = bySubCat._id;
				product = bySubCat;
			}
		}

		if (!product)
			throw new AppError(
				`FoodItem or specific option with ID ${itemId} not found`,
				404,
			);

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
			resolvedName = product.name;
		} else {
			if (!mongoose.isValidObjectId(finalSubCatId))
				throw new AppError(`Invalid subCategoryItemId: ${finalSubCatId}`, 400);

			let foundItem = null;
			let foundInSubCat = null;

			for (const subCat of product.subCategory) {
				const match = subCat.items.find(
					(i) => i._id.toString() === finalSubCatId.toString(),
				);
				if (match) {
					foundItem = match;
					foundInSubCat = subCat;
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
			resolvedName = foundItem.name;

			if (
				foundItem.minQuantity !== undefined &&
				foundItem.minQuantity !== null &&
				quantity < foundItem.minQuantity
			) {
				throw new AppError(
					`Minimum quantity for "${resolvedName}" is ${foundItem.minQuantity}`,
					400,
				);
			}

			if (
				foundItem.maxQuantity !== undefined &&
				foundItem.maxQuantity !== null &&
				quantity > foundItem.maxQuantity
			) {
				throw new AppError(
					`Maximum quantity for "${resolvedName}" is ${foundItem.maxQuantity}`,
					400,
				);
			}
		}

		if (product.subCategory) {
			for (const subCat of product.subCategory) {
				if (!subCat.required) continue;
				if (subCat.items && subCat.items.length > 0) {
					const isThisSubCatSelected = subCat.items.some(
						(i) => i._id.toString() === (finalSubCatId || "").toString(),
					);
					if (!isThisSubCatSelected && !isFlatItem) {
						throw new AppError(
							`A selection from "${subCat.name}" is required for "${product.name}"`,
							400,
						);
					}
				}
			}
		}
	} else if (itemType === "Combo") {
		const product = await ProductModel.findById(actualItemId)
			.select("basePrice comboName selections isAvailable")
			.lean();

		if (!product)
			throw new AppError(`Combo with ID ${actualItemId} not found`, 404);

		if (product.isAvailable === false)
			throw new AppError(
				`Combo "${product.comboName}" is currently unavailable`,
				400,
			);

		itemPrice = product.basePrice;
		resolvedName = product.comboName;

		validatedComboSelections = [];

		if (product.selections && product.selections.length > 0) {
			const userSelections = (comboSelections || []).map((s) => {
				if (typeof s === "string" || s instanceof mongoose.Types.ObjectId) {
					return { itemId: s.toString(), quantity: 1 };
				}
				return {
					itemId: (s.itemId || s.item || "").toString(),
					quantity: Number(s.quantity) || 1,
				};
			});

			const unmatchedUserSelections = [...userSelections];

			for (const group of product.selections) {
				const matchedItemsInGroup = [];
				let totalGroupQuantity = 0;

				for (let i = unmatchedUserSelections.length - 1; i >= 0; i--) {
					const uItem = unmatchedUserSelections[i];
					const uIdStr = uItem.itemId;
					const uQuantity = uItem.quantity;

					const foundItem = group.items.find(
						(item) =>
							item.item.toString() === uIdStr || item._id.toString() === uIdStr,
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
						`Selection from "${group.label}" is required for combo "${resolvedName}"`,
						400,
					);
				}

				if (totalGroupQuantity > group.maxSelection) {
					throw new AppError(
						`You can only select up to ${group.maxSelection} items from "${group.label}"`,
						400,
					);
				}

				if (
					group.minSelection !== undefined &&
					group.minSelection !== null &&
					totalGroupQuantity > 0 &&
					totalGroupQuantity < group.minSelection
				) {
					throw new AppError(
						`You must select at least ${group.minSelection} item(s) from "${group.label}"`,
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
					`Some selected items are not valid options for the combo "${resolvedName}"`,
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
		resolvedName = product.name;
	}

	if (itemPrice === undefined || isNaN(itemPrice)) {
		throw new AppError(
			`Cannot determine price for ${itemType} with ID ${actualItemId}`,
			400,
		);
	}

	return {
		itemPrice,
		resolvedName,
		validatedComboSelections,
		actualItemId,
		finalSubCatId,
	};
};

const createOrder = async (userId, data) => {
	const {
		items,
		vendorId,
		deliveryAddress,
		deliveryLatitude,
		deliveryLongitude,
	} = data;

	if (!mongoose.isValidObjectId(vendorId)) {
		throw new AppError(`Invalid Vendor ID: ${vendorId}`, 400); // FIX #11
	}

	// FIX #13: validate deliveryAddress early
	if (
		!deliveryAddress ||
		typeof deliveryAddress !== "string" ||
		!deliveryAddress.trim()
	) {
		throw new AppError("Delivery address is required", 400);
	}

	if (!items || items.length === 0) {
		throw new AppError("No items in the order.", 400); // FIX #11
	}

	// 1. Fetch Vendor
	const vendor = await VendorProfile.findById(vendorId);
	if (!vendor) throw new AppError("Vendor not found", 404); // FIX #11
	if (!vendor.location || !vendor.location.coordinates) {
		throw new AppError("Vendor has no location set", 400);
	}
	const vendorAddress = vendor.location.address;
	if (!vendorAddress) {
		throw new AppError("Vendor address is missing", 400);
	}

	// 1b. Enforce vendor operating schedule
	if (!isVendorOpenNow(vendor)) {
		throw new AppError(buildClosedReason(vendor), 400);
	}

	// 2. Identify Zone
	const [vendorLng, vendorLat] = vendor.location.coordinates;
	const orderZone = identifyZone(vendorAddress, vendor.zone);
	logger.info(
		`[Order] Zone resolved: "${orderZone}" (vendor.zone="${vendor.zone}", address="${vendorAddress}")`,
	);

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

		const {
			itemPrice,
			resolvedName,
			validatedComboSelections,
			actualItemId,
			finalSubCatId,
		} = await _calculateAndValidateItemPrice(item, models);

		itemsTotalPrice += itemPrice * quantity;

		const orderItemData = {
			itemType,
			item: actualItemId,
			name: resolvedName,
			quantity,
			price: itemPrice,
			notes,
			subCategoryItemId: finalSubCatId || null,
		};

		if (itemType === "Combo") {
			orderItemData.comboSelections = validatedComboSelections;
		}

		orderItems.push(orderItemData);
	}

	// 4a. Enforce minimum order amount
	const minOrderAmount = vendor.fulfillmentSettings?.minOrderAmount ?? 0;
	if (minOrderAmount > 0 && itemsTotalPrice < minOrderAmount) {
		throw new AppError(
			`This vendor requires a minimum order of ₦${minOrderAmount.toLocaleString()}. Your cart total is ₦${itemsTotalPrice.toLocaleString()}.`,
			400,
		);
	}

	const orderedFoodItemParentIds = [
		...new Set(
			orderItems
				.filter((oi) => oi.itemType === "FoodItem")
				.map((oi) => oi.item.toString()),
		),
	];

	if (orderedFoodItemParentIds.length > 0) {
		const compulsoryParents = await FoodItem.find({
			_id: { $in: orderedFoodItemParentIds },
			isCompulsory: true,
		})
			.select("_id name subCategory")
			.lean();

		for (const parent of compulsoryParents) {
			const orderedSubCatIds = new Set(
				orderItems
					.filter(
						(oi) =>
							oi.itemType === "FoodItem" &&
							oi.item.toString() === parent._id.toString() &&
							oi.subCategoryItemId,
					)
					.map((oi) => oi.subCategoryItemId.toString()),
			);

			for (const subCat of parent.subCategory || []) {
				if (!subCat.items || subCat.items.length === 0) continue;
				const groupCovered = subCat.items.some((i) =>
					orderedSubCatIds.has(i._id.toString()),
				);
				if (!groupCovered) {
					throw new AppError(
						`"${parent.name}" requires a selection from "${subCat.name}" — please add it to your order.`,
						400,
					);
				}
			}
		}
	}

	// 5. Lookup Customer
	const customer = await Customer.findOne({ user: userId });
	if (!customer) throw new AppError("Customer profile not found", 404); // FIX #11

	// 6. Calculate fees via shared helper (FIX #12)
	const { serviceFee, vendorEarning } = _calculateFees(
		itemsTotalPrice,
		vendor.tier,
	);

	// 6b. Resolve delivery coordinates
	let finalDeliveryLat = deliveryLatitude ?? null;
	let finalDeliveryLng = deliveryLongitude ?? null;
	if (
		(finalDeliveryLat === null || finalDeliveryLng === null) &&
		customer.savedAddresses?.length > 0
	) {
		const matched =
			customer.savedAddresses.find(
				(a) =>
					a.address &&
					deliveryAddress &&
					a.address.toLowerCase().trim() ===
						deliveryAddress.toLowerCase().trim(),
			) || customer.savedAddresses[0];
		if (matched?.coordinates?.length === 2) {
			finalDeliveryLng = matched.coordinates[0];
			finalDeliveryLat = matched.coordinates[1];
		}
	}

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
		isPreorder: vendor.storeDetails?.[0]?.servicesOffered === "preOrderMeals",
		preparationTime:
			vendor.storeDetails?.[0]?.preorderPeriods?.[0]?.preparationTime,
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
	// 9. Send order confirmation email
	try {
		const user = await User.findById(userId).select("email firstName").lean();
		if (user?.email) {
			const orderCount = await Order.countDocuments({ customer: customer._id });
			const emailPayload = {
				customerName: user.firstName,
				orderNumber: order.orderNumber,
				status: order.status,
				vendorName: vendor.storeName,
				paymentMethod: order.paymentMethod,
				paymentStatus: order.paymentStatus,
				orderDate: order.createdAt.toLocaleDateString("en-NG", {
					day: "numeric",
					month: "short",
					year: "numeric",
				}),
				items: orderItems,
				foodTotal: order.foodTotal,
				deliveryFee: order.deliveryFee,
				serviceFee: order.serviceFee,
				totalPrice: order.totalPrice,
				deliveryAddress: order.deliveryAddress,
				deliveryZone: order.zone,
			};

			if (orderCount === 1) {
				await emailService.sendFirstOrderConfirmationEmail(
					user.email,
					emailPayload,
				);
				logger.info(`First order confirmation email sent to ${user.email}`);
			} else if (orderCount === 10) {
				await emailService.sendTenthOrderEmail(user.email, emailPayload);
				logger.info(`10th order milestone email sent to ${user.email}`);
			} else {
				await emailService.sendOrderConfirmationEmail(user.email, emailPayload);
				logger.info(`Order confirmation email sent to ${user.email}`);
			}
		}
	} catch (error) {
		logger.error(`Failed to send order confirmation email: ${error.message}`);
	}

	return order;
};

/**
 * Calculate totalPrice, deliveryFee, serviceFee for a cart WITHOUT creating an order.
 * Schedule enforcement is intentionally skipped — price preview should not be
 * blocked by operating hours.
 */
const estimateOrderPrice = async (cartData) => {
	const { items, vendorId, deliveryAddress } = cartData;

	if (!mongoose.isValidObjectId(vendorId))
		throw new AppError(`Invalid Vendor ID: ${vendorId}`, 400); // FIX #11
	if (!items || items.length === 0)
		throw new AppError("No items in the cart.", 400);

	// FIX #13: validate deliveryAddress early
	if (
		!deliveryAddress ||
		typeof deliveryAddress !== "string" ||
		!deliveryAddress.trim()
	) {
		throw new AppError("Delivery address is required", 400);
	}

	const vendor = await VendorProfile.findById(vendorId);
	if (!vendor) throw new AppError("Vendor not found", 404);
	if (!vendor.location?.address)
		throw new AppError("Vendor address is missing", 400);

	if (!isVendorOpenNow(vendor)) {
		throw new AppError(buildClosedReason(vendor), 400);
	}

	const fee = await calculateOunjeFee(vendor.location.address, deliveryAddress);
	const models = { FoodItem, Combo, Plate };

	let itemsTotalPrice = 0;
	for (const item of items) {
		const { itemPrice } = await _calculateAndValidateItemPrice(item, models);
		itemsTotalPrice += itemPrice * (item.quantity ?? 1);
	}

	// FIX #12: use shared fee helper
	const { serviceFee, vendorEarning } = _calculateFees(
		itemsTotalPrice,
		vendor.tier,
	);

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
		populate: { path: "user", select: "fcmToken" },
	});
	if (!order) throw new AppError("Order not found", 404); // FIX #11

	order.status = status;
	order.subStatus = subStatus || "";
	await order.save();

	_emitOrderUpdate(order.customer._id, {
		orderId: order._id,
		status: order.status,
		subStatus: order.subStatus,
	});

	const fcmToken = order.customer?.user?.fcmToken ?? null;
	if (fcmToken) {
		const title = `Order Update: ${status}`;
		const body = subStatus || `Your order is now ${status}`;
		await sendPushNotification(fcmToken, title, body);
	}

	return order;
};

const sendDeliveryOtp = async (order) => {
	if (!order) throw new AppError("Order required", 400);
	const customer = await Customer.findById(order.customer);
	if (!customer) throw new AppError("Customer not found", 404);

	const otp = generateNumericOtp(
		parseInt(process.env.DELIVERY_OTP_LENGTH || 6),
	);
	const otpHash = hashOtp(otp);
	const duration = parseInt(process.env.DELIVERY_OTP_DURATION || 1440); // 24 hours

	order.deliveryOtpCode = otp;
	order.deliveryOtpHash = otpHash;
	order.deliveryOtpSentAt = new Date();
	order.deliveryOtpExpiresAt = new Date(Date.now() + duration * 60 * 1000);
	// Intentionally NOT setting order.deliveryOtpCode
	await order.save();

	logger.info(
		`Generated OTP for order ${order._id} (hash stored, plaintext not persisted)`,
	);

	try {
		if (global.io) {
			global.io.to(order.customer.toString()).emit("delivery-otp", {
				orderId: order._id,
				customerId: order.customer,
				otp, // sent over encrypted socket only, never stored
				expiresAt: order.deliveryOtpExpiresAt,
			});
		}
	} catch (err) {
		logger.error(`Failed to emit delivery OTP via socket.io: ${err.message}`);
	}

	return { success: true };
};

const verifyDeliveryOtp = async (order, otp, riderId) => {
	if (!order) throw new AppError("Order required", 400);
	if (!otp) throw new AppError("OTP required", 400);
	if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt)
		throw new AppError("No OTP session found for this order", 400);

	if (new Date() > new Date(order.deliveryOtpExpiresAt))
		throw new AppError("OTP expired", 400);

	const providedHash = hashOtp(otp);
	if (providedHash !== order.deliveryOtpHash)
		throw new AppError("Invalid OTP", 400);

	// FIX #4: persist the order status change BEFORE triggering any financial
	// side effects. If the save fails, no money moves. If a ledger call fails
	// after the save, the order is already marked delivered and the ledger
	// release can be retried via an admin tool or background job.
	order.status = ORDER_STATUS.DELIVERED;
	order.subStatus = ORDER_SUB_STATUS.DELIVERED;
	order.deliveryConfirmedAt = new Date();
	order.deliveryConfirmedBy = riderId;
	order.deliveryOtpHash = null;
	order.deliveryOtpExpiresAt = null;
	order.deliveryOtpSentAt = null;

	await order.save(); // ← save first, then release funds

	await ledgerService.releaseRiderFee(order.rider, order._id);

	try {
		await ledgerService.releaseVendorAmount(order.vendor, order._id);
	} catch (vendorLedgerErr) {
		logger.error(
			`Failed to release vendor amount for order ${order._id}: ${vendorLedgerErr.message}`,
		);
		// Non-blocking — delivery already confirmed
	}

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
		logger.error(`Stats update failed for order ${order._id}: ${err.message}`);
	}

	try {
		const vendorService = require("./vendor.service"); // FIX #7 note: see architecture note below
		await vendorService.updateVendorRankingScore(order.vendor);
	} catch (err) {
		logger.error(
			`Vendor ranking update failed for order ${order._id}: ${err.message}`,
		);
	}
	try {
		const customer = await Customer.findById(order.customer).populate(
			"orderCount",
		);
		if (customer) {
			customer.rank = calculateCustomerRank(customer.orderCount);
			await customer.save();
		}
	} catch (err) {
		logger.error(
			`Customer rank update failed for order ${order._id}: ${err.message}`,
		);
	}

	try {
		if (order.rider) {
			const riderService = require("./rider.service");
			await riderService.updateRiderRankingScore(order.rider);
		}
	} catch (err) {
		logger.error(
			`Rider ranking update failed for order ${order._id}: ${err.message}`,
		);
	}

	return { success: true };
};

// FIX #1: merge the active-ride guard INTO the atomic findOneAndUpdate so
// there is no race window between the check and the claim.
const acceptOrder = async (orderId, riderId) => {
	const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

	const order = await Order.findOneAndUpdate(
		{
			_id: orderId,
			// Only claim if no other rider has it yet
			$or: [
				{
					status: ORDER_STATUS.RIDING,
					subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
					rider: null,
				},
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
		if (!existingOrder) throw new AppError("Order not found", 404);
		throw new AppError(
			"Order is no longer available. Another rider may have accepted it.",
			409,
		);
	}

	// FIX #1: active-ride check AFTER the atomic claim so we don't hold the
	// slot and then bounce — if the rider already has an active ride we undo
	// the claim immediately.
	const activeRide = await Order.findOne({
		rider: riderId,
		_id: { $ne: order._id }, // exclude the order we just claimed
		status: ORDER_STATUS.RIDING,
		subStatus: {
			$in: [
				ORDER_SUB_STATUS.RIDER_ASSIGNED,
				ORDER_SUB_STATUS.PICKED_UP,
				ORDER_SUB_STATUS.ON_THE_WAY,
			],
		},
		updatedAt: { $gte: twoHoursAgo },
	});

	if (activeRide) {
		// Roll back — release the slot so another rider can take it
		await Order.findByIdAndUpdate(orderId, {
			$set: {
				rider: null,
				status: ORDER_STATUS.RIDING,
				subStatus: ORDER_SUB_STATUS.LOOKING_FOR_RIDER,
			},
		});
		throw new AppError(
			"You already have an active delivery. Complete or decline it first.",
			409,
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

	try {
		const { cancelDispatch } = require("./order.rider.service");
		cancelDispatch(orderId);
	} catch (dispatchErr) {
		logger.warn(`cancelDispatch non-fatal error: ${dispatchErr.message}`);
	}

	try {
		const updatedRider = await RiderProfile.findByIdAndUpdate(
			riderId,
			{ $inc: { ordersAccepted: 1 } },
			{ new: true, select: "ordersOffered ordersAccepted" },
		);
		if (updatedRider) {
			const rate =
				updatedRider.ordersOffered > 0
					? Math.round(
							(updatedRider.ordersAccepted / updatedRider.ordersOffered) * 100,
						)
					: 100;
			await RiderProfile.findByIdAndUpdate(riderId, { acceptanceRate: rate });
			const riderSvc = require("./rider.service");
			await riderSvc.updateRiderRankingScore(riderId);
		}
	} catch (rankErr) {
		logger.error(`Rider ranking update failed on accept: ${rankErr.message}`);
	}

	try {
		if (order.deliveryFee > 0) {
			await ledgerService.holdRiderFee(riderId, order.deliveryFee, order._id);
		}
	} catch (ledgerErr) {
		logger.error(
			`Failed to hold rider fee for order ${orderId}: ${ledgerErr.message}`,
		);
	}

	logger.info(`Rider ${riderId} accepted Order ${orderId}`);

	return order;
};

const pickUpOrder = async (orderId, riderId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new AppError("Order not found", 404); // FIX #11

	if (order.rider.toString() !== riderId) {
		throw new AppError("You are not the assigned rider for this order", 403);
	}

	order.status = ORDER_STATUS.RIDING;
	order.subStatus = ORDER_SUB_STATUS.PICKED_UP;
	await order.save();

	// FIX #2: order.deliveryOtpCode no longer exists on the document.
	// Always re-generate and emit a fresh OTP at pickup.
	// (For legacy orders that still have the field, sendDeliveryOtp will
	//  overwrite the hash, which is safe.)
	await sendDeliveryOtp(order);

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
	if (!order) throw new AppError("Order not found", 404);

	if (order.rider.toString() !== riderId) {
		throw new AppError("Not assigned to you", 403);
	}

	// if (
	// 	order.status !== ORDER_STATUS.RIDING ||
	// 	order.subStatus !== ORDER_SUB_STATUS.PICKED_UP
	// ) {
	// 	throw new AppError("Order is not ready for delivery confirmation", 400);
	// }

	try {
		await notificationService.notifyCustomerRiderArrived(order.customer, order);
		logger.info(
			`Rider has arrived notification sent to customer ${order.customer}`,
		);
	} catch (error) {
		logger.error(
			`Failed to send rider has arrived notification: ${error.message}`,
		);
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
	if (!order) throw new AppError("Order not found", 404); // FIX #11

	if (order.customer.toString() !== customerId) {
		throw new AppError("You can only cancel your own orders", 403);
	}

	// FIX: also check subStatus so a vendor-accepted order (status=CONFIRMING,
	// subStatus=CONFIRMED) cannot be cancelled by the customer.
	// Cancellation is only allowed at the very first stage — before the vendor acts.
	if (
		order.status !== ORDER_STATUS.CONFIRMING ||
		order.subStatus !== ORDER_SUB_STATUS.CONFIRMING
	) {
		throw new AppError(
			"You can only cancel orders before the vendor accepts",
			400,
		);
	}

	order.status = ORDER_STATUS.CANCELLED;
	order.subStatus = ORDER_SUB_STATUS.CANCELLED;
	order.cancelledAt = new Date();
	order.cancelledBy = customerId;
	order.cancellationCategory = "customer";

	await order.save();

	// Refund customer
	if (order.paymentStatus === "paid") {
		try {
			if (order.paymentMethod === "wallet") {
				await ledgerService.creditAccount(
					order.customer,
					"CUSTOMER",
					order.totalPrice,
					"REFUND",
					order._id,
					{ reason: "customer_cancelled" },
				);
				order.paymentStatus = "refunded";
				await order.save();
			} else if (order.paymentMethod === "paystack") {
				const payment = await Payment.findOne({
					orderId: order._id,
					status: "success",
				});
				if (payment) {
					try {
						await refundTransaction(payment.reference, order.totalPrice * 100);
						order.paymentStatus = "refunded";
						await order.save();
						logger.info(
							`[REFUND] Paystack refund issued for cancelled order ${order._id}`,
						);
					} catch (refundErr) {
						logger.error(
							`[REFUND] Paystack refund failed for order ${order._id}: ${refundErr.message}`,
						);
					}
				}
			}
		} catch (error) {
			logger.error(
				`Failed to refund customer for cancelled order ${orderId}: ${error.message}`,
			);
		}
	}

	// Reverse vendor/rider ledger entries
	try {
		await ledgerService.reverseOrderEarnings(order);
	} catch (error) {
		logger.error(
			`Failed to reverse ledger for cancelled order ${orderId}: ${error.message}`,
		);
	}

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

const vendorAcceptOrder = async (orderId, vendorId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new AppError("Order not found", 404); // FIX #11

	if (order.vendor.toString() !== vendorId) {
		throw new AppError("You can only accept orders from your restaurant", 403);
	}

	if (order.status !== ORDER_STATUS.CONFIRMING) {
		throw new AppError("Order is no longer in confirming status", 400);
	}

	order.status = ORDER_STATUS.CONFIRMING;
	order.subStatus = ORDER_SUB_STATUS.CONFIRMED;
	await order.save();

	try {
		await ledgerService.pendVendorEarning(order.vendor, order._id);
		logger.info(
			`[WALLET] Vendor earning moved to pending: orderId=${orderId} vendorId=${order.vendor} amount=${order.vendorEarning}`,
		);
	} catch (ledgerErr) {
		logger.error(
			`[WALLET] Failed to pend vendor earning on accept: orderId=${orderId} err=${ledgerErr.message}`,
		);
	}

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
	if (!order) throw new AppError("Order not found", 404); // FIX #11

	if (role === "rider") {
		const { RiderProfile } = require("../models");
		const rider = await RiderProfile.findOne({ user: userId });
		if (!rider || order.rider.toString() !== rider._id.toString()) {
			throw new AppError("You are not the assigned rider for this order", 403);
		}
	} else if (role === "customer") {
		const { Customer } = require("../models");
		const customer = await Customer.findOne({ user: userId });
		if (!customer || order.customer.toString() !== customer._id.toString()) {
			throw new AppError("You are not the customer for this order", 403);
		}
	} else {
		throw new AppError("Only customer or rider can resend OTP", 403);
	}

	if (order.paymentStatus !== "paid") {
		throw new AppError("Order must be paid before resending OTP", 400);
	}

	if (
		order.status === ORDER_STATUS.DELIVERED ||
		order.status === ORDER_STATUS.CANCELLED
	) {
		throw new AppError(
			"Cannot resend OTP for a completed or cancelled order",
			400,
		);
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
	generateNumericOtp,
	hashOtp,
};
