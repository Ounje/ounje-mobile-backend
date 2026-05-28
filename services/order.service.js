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
	Promotion, // Added
} = require("../models");
const promoService = require("../services/promo.service");
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
const emailService = require("./email/EmailService");
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

// ── UPDATED CONSTANTS ─────────────────────────────────────────────────────────
// The 10% service fee is permanent and independent of food item markups.
const SERVICE_FEE_RATE = 0.1;
const EXEMPT_CATEGORIES = ["drinks"];

// ── _calculateFees ────────────────────────────────────────────────────────────
// Full replacement. Vendor always receives originalPrice. Platform keeps the markup.
const _calculateFees = (items, promoApplied = false) => {
	let vendorEarning = 0;
	let platformMarkupRevenue = 0;
	let comboMarkupRevenue = 0;
	let comboSubtotal = 0;

	for (const item of items) {
		const qty = item.quantity ?? 1;
		const paidPrice = item.price;
		const exempt = EXEMPT_CATEGORIES.includes(item.category?.toLowerCase());

		if (item.itemType === "Combo") {
			// Vendor always gets originalPrice.
			// Standard Markup is 10%. Combo Markup is extra 20%.
			// Reverse: Price / (1.10 * 1.20)
			const originalPrice =
				item.originalPrice ?? Math.round(paidPrice / (1.1 * 1.2));
			const withPlatformMarkup = Math.round(originalPrice * 1.1);

			vendorEarning += originalPrice * qty;
			platformMarkupRevenue += (withPlatformMarkup - originalPrice) * qty;

			if (!promoApplied) {
				comboMarkupRevenue += (paidPrice - withPlatformMarkup) * qty;
			} else {
				// If promo applied, we effectively drop the 20% markup
				// The discount calculation handles the subtraction from totalPrice later
			}
			comboSubtotal += item.price * qty;
		} else {
			// FoodItem or Plate
			const originalPrice =
				item.originalPrice ??
				(exempt ? paidPrice : Math.round(paidPrice / 1.1));

			vendorEarning += originalPrice * qty;

			if (!exempt) {
				platformMarkupRevenue += (paidPrice - originalPrice) * qty;
			}
		}
	}

	const serviceFee = Math.round(vendorEarning * SERVICE_FEE_RATE);

	return {
		serviceFee,
		vendorEarning,
		platformMarkupRevenue,
		comboMarkupRevenue,
		comboSubtotal,
	};
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
	let originalPrice = null;

	if (itemType === "FoodItem") {
		let product = await ProductModel.findOne({
			_id: actualItemId,
			isAvailable: true,
		})
			.select("subCategory isAvailable name price originalPrice")
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
				.select("subCategory isAvailable name price originalPrice")
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
			originalPrice = product.originalPrice ?? Math.round(itemPrice / 1.1);
			finalSubCatId = null;
			resolvedName = product.name;
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
			originalPrice = foundItem.originalPrice ?? Math.round(itemPrice / 1.1);
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
			.select("basePrice comboName selections isAvailable originalPrice")
			.lean();

		if (!product)
			throw new AppError(`Combo with ID ${actualItemId} not found`, 404);

		if (product.isAvailable === false)
			throw new AppError(
				`Combo "${product.comboName}" is currently unavailable`,
				400,
			);

		itemPrice = product.basePrice;
		originalPrice =
			product.originalPrice ?? Math.round(itemPrice / (1.1 * 1.2));
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
			.select("price name originalPrice")
			.lean();

		if (!product)
			throw new AppError(`Plate with ID ${actualItemId} not found`, 404);

		itemPrice = product.price;
		originalPrice = product.originalPrice ?? Math.round(itemPrice / 1.1);
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
		originalPrice,
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
		throw new AppError(`Invalid Vendor ID: ${vendorId}`, 400);
	}

	if (
		!deliveryAddress ||
		typeof deliveryAddress !== "string" ||
		!deliveryAddress.trim()
	) {
		throw new AppError("Delivery address is required", 400);
	}

	if (!items || items.length === 0) {
		throw new AppError("No items in the order.", 400);
	}

	// 1. Fetch Vendor
	const vendor = await VendorProfile.findById(vendorId);
	if (!vendor) throw new AppError("Vendor not found", 404);
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
			originalPrice,
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
			price: itemPrice, // marked-up price customer pays
			originalPrice: originalPrice, // vendor's true price
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
	if (!customer) throw new AppError("Customer profile not found", 404);

	// 6. Calculate fees with the promo code flag
	const promoApplied = !!data.promoCode;

	let discountAmount = 0;
	let promo = null;
	const {
		serviceFee,
		vendorEarning,
		platformMarkupRevenue,
		comboMarkupRevenue,
		comboSubtotal,
	} = _calculateFees(orderItems, promoApplied);

	if (promoApplied) {
		promo = await promoService.findPromoByCode(data.promoCode); // ← no `const`

		const promoError = promoService.getPromoError(promo, userId, {
			total: itemsTotalPrice,
			comboSubtotal,
		});

		if (promoError) throw new AppError(promoError.message, promoError.status);

		discountAmount = promoService.calculateDiscount(
			promo,
			itemsTotalPrice,
			comboSubtotal,
		);
	}

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
		totalPrice: Math.max(
			0,
			itemsTotalPrice + fee + serviceFee - discountAmount,
		),
		deliveryFee: fee,
		serviceFee,
		foodTotal: itemsTotalPrice,
		discountAmount,
		promoCodeApplied: promo ? promo.code : null,
		vendorEarning,
		platformMarkupRevenue, // new field
		comboMarkupRevenue, // new field
		deliveryAddress,
		deliveryLatitude: finalDeliveryLat,
		deliveryLongitude: finalDeliveryLng,
		status: ORDER_STATUS.CONFIRMING,
		subStatus: ORDER_SUB_STATUS.CONFIRMING,
		zone: orderZone,
		isPreorder: vendor.storeDetails?.[0]?.servicesOffered === "preOrderMeals",
		preparationTime:
			vendor.storeDetails?.[0]?.preorderPeriods?.[0]?.preparationTime,
		paymentMethod: data.paymentMethod || "wallet",
	});
	order.orderNumber = await generateOrderNumber(order._id);
	await order.save();

	if (promo) {
		await Promotion.findByIdAndUpdate(promo._id, {
			$inc: { usedCount: 1 },
			$addToSet: { usedBy: userId },
		});
	}

	// 8. Notify vendor
	try {
		await notificationService.notifyNewOrder(vendorId, order);
		logger.info(`New order notification sent to vendor ${vendorId}`);
	} catch (error) {
		logger.error(`Failed to send new order notification: ${error.message}`);
	}

	return order;
};

/**
 * Send order confirmation email after payment is confirmed.
 */
const sendOrderConfirmationEmailForOrder = async (order, vendor, user) => {
	try {
		const orderCount = await Order.countDocuments({ customer: order.customer });
		const emailPayload = {
			customerName: user.name,
			orderNumber: order.orderNumber,
			status: order.status,
			vendorName: vendor?.storeDetails?.[0]?.storeName || vendor?.name || "",
			paymentMethod: order.paymentMethod,
			paymentStatus: order.paymentStatus,
			orderDate: order.createdAt.toLocaleDateString("en-NG", {
				day: "numeric",
				month: "short",
				year: "numeric",
			}),
			items: order.items,
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
	} catch (error) {
		logger.error(`Failed to send order confirmation email: ${error.message}`);
	}
};

/**
 * Calculate totalPrice, deliveryFee, serviceFee for a cart WITHOUT creating an order.
 */
const estimateOrderPrice = async (cartData, userId) => {
	const { items, vendorId, deliveryAddress, promoCode } = cartData;

	if (!mongoose.isValidObjectId(vendorId))
		throw new AppError(`Invalid Vendor ID: ${vendorId}`, 400);
	if (!items || items.length === 0)
		throw new AppError("No items in the cart.", 400);

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
	const formattedItems = [];
	for (const item of items) {
		const { itemPrice, originalPrice, resolvedName } =
			await _calculateAndValidateItemPrice(item, models);
		itemsTotalPrice += itemPrice * (item.quantity ?? 1);
		formattedItems.push({
			...item,
			name: resolvedName,
			price: itemPrice,
			originalPrice: originalPrice,
		});
	}

	const promoApplied = !!promoCode;
	const { serviceFee, vendorEarning, comboSubtotal } = _calculateFees(
		formattedItems,
		promoApplied,
	);

	let discountAmount = 0;
	if (promoApplied) {
		const promo = await promoService.findPromoByCode(promoCode);

		const promoError = promoService.getPromoError(promo, userId, {
			total: itemsTotalPrice,
			comboSubtotal, // ← was hardcoded 0
		});

		if (!promoError && promo) {
			discountAmount = promoService.calculateDiscount(
				promo,
				itemsTotalPrice,
				comboSubtotal,
			);
		}
	}

	const baseTotal = itemsTotalPrice + fee + serviceFee;

	return {
		foodTotal: itemsTotalPrice,
		deliveryFee: fee,
		serviceFee,
		discountAmount,
		totalPrice: Math.max(0, baseTotal - discountAmount),
		vendorEarning,
	};
};

const updateOrderStatus = async (orderId, status, subStatus) => {
	const order = await Order.findById(orderId).populate({
		path: "customer",
		populate: { path: "user", select: "fcmToken" },
	});
	if (!order) throw new AppError("Order not found", 404);

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
	const duration = parseInt(process.env.DELIVERY_OTP_DURATION || 1440);

	order.deliveryOtpCode = otp;
	order.deliveryOtpHash = otpHash;
	order.deliveryOtpSentAt = new Date();
	order.deliveryOtpExpiresAt = new Date(Date.now() + duration * 60 * 1000);
	await order.save();

	logger.info(
		`Generated OTP for order ${order._id} (hash stored, plaintext not persisted)`,
	);

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
	if (!order) throw new AppError("Order required", 400);
	if (!otp) throw new AppError("OTP required", 400);
	if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt)
		throw new AppError("No OTP session found for this order", 400);

	if (new Date() > new Date(order.deliveryOtpExpiresAt))
		throw new AppError("OTP expired", 400);

	const providedHash = hashOtp(otp);
	if (providedHash !== order.deliveryOtpHash)
		throw new AppError("Invalid OTP", 400);

	order.status = ORDER_STATUS.DELIVERED;
	order.subStatus = ORDER_SUB_STATUS.DELIVERED;
	order.deliveryConfirmedAt = new Date();
	order.deliveryConfirmedBy = riderId;
	order.deliveryOtpHash = null;
	order.deliveryOtpExpiresAt = null;
	order.deliveryOtpSentAt = null;

	await order.save();

	await ledgerService.releaseRiderFee(order.rider, order._id);

	try {
		await ledgerService.releaseVendorAmount(order.vendor, order._id);
	} catch (vendorLedgerErr) {
		logger.error(
			`Failed to release vendor amount for order ${order._id}: ${vendorLedgerErr.message}`,
		);
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
		const vendorService = require("./vendor.service");
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

const acceptOrder = async (orderId, riderId) => {
	const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

	const order = await Order.findOneAndUpdate(
		{
			_id: orderId,
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

	const activeRide = await Order.findOne({
		rider: riderId,
		_id: { $ne: order._id },
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

	if (global.io) {
		const payload = {
			orderId: order._id.toString(),
			status: order.status,
			subStatus: order.subStatus,
		};
		const rooms = [order.vendor?.toString(), riderId.toString()].filter(Boolean);
		rooms.forEach((room) => {
			global.io.to(room).emit("orderUpdate", payload);
		});
	}

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
	if (!order) throw new AppError("Order not found", 404);

	if (order.rider.toString() !== riderId) {
		throw new AppError("You are not the assigned rider for this order", 403);
	}

	order.status = ORDER_STATUS.RIDING;
	order.subStatus = ORDER_SUB_STATUS.PICKED_UP;
	await order.save();

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

	if (global.io) {
		const payload = {
			orderId: order._id.toString(),
			status: order.status,
			subStatus: order.subStatus,
		};
		const rooms = [order.customer?.toString(), order.vendor?.toString(), riderId].filter(Boolean);
		rooms.forEach((room) => {
			global.io.to(room).emit("orderUpdate", payload);
		});
	}

	return order;
};

const completeDelivery = async (orderId, riderId, otp) => {
	const order = await Order.findById(orderId);
	if (!order) throw new AppError("Order not found", 404);

	if (order.rider.toString() !== riderId) {
		throw new AppError("Not assigned to you", 403);
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

	if (global.io) {
		const payload = {
			orderId: order._id.toString(),
			status: ORDER_STATUS.DELIVERED,
			subStatus: ORDER_SUB_STATUS.DELIVERED,
		};
		const rooms = [order.vendor?.toString(), riderId.toString()].filter(Boolean);
		rooms.forEach((room) => {
			global.io.to(room).emit("orderUpdate", payload);
		});
		logger.info(`Delivered status emitted to vendor ${order.vendor} and rider ${riderId}`);
	}

	logger.info(`Order ${orderId} delivered by Rider ${riderId}`);

	return order;
};

const cancelOrder = async (orderId, customerId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new AppError("Order not found", 404);

	if (order.customer.toString() !== customerId) {
		throw new AppError("You can only cancel your own orders", 403);
	}

	if (
		order.status !== ORDER_STATUS.CONFIRMING ||
		order.subStatus !== ORDER_SUB_STATUS.CONFIRMING
	) {
		throw new AppError(
			"You can only cancel orders before the vendor accepts",
			400,
		);
	}

	// Atomically transition the order to cancelled only if it is still confirming
	const updatedOrder = await Order.findOneAndUpdate(
		{ 
			_id: orderId, 
			status: ORDER_STATUS.CONFIRMING,
			subStatus: ORDER_SUB_STATUS.CONFIRMING
		},
		{
			$set: {
				status: ORDER_STATUS.CANCELLED,
				subStatus: ORDER_SUB_STATUS.CANCELLED,
				cancelledAt: new Date(),
				cancelledBy: customerId,
				cancellationCategory: "customer",
			}
		},
		{ new: true }
	);

	if (!updatedOrder) {
		throw new AppError(
			"Order has already been accepted, cancelled, or declined.",
			400,
		);
	}

	if (updatedOrder.paymentStatus === "paid") {
		try {
			if (updatedOrder.paymentMethod === "wallet") {
				// Atomically transition paymentStatus from paid to refunded
				const refundedOrder = await Order.findOneAndUpdate(
					{ _id: updatedOrder._id, paymentStatus: "paid" },
					{ $set: { paymentStatus: "refunded" } },
					{ new: true }
				);
				if (refundedOrder) {
					await ledgerService.creditAccount(
						updatedOrder.customer,
						"CUSTOMER",
						updatedOrder.totalPrice,
						"REFUND",
						updatedOrder._id,
						{ reason: "customer_cancelled" },
					);
				}
			} else if (updatedOrder.paymentMethod === "paystack") {
				const payment = await Payment.findOne({
					orderId: updatedOrder._id,
					status: "success",
				});
				if (payment) {
					// Atomically transition paymentStatus from paid to refunded
					const refundedOrder = await Order.findOneAndUpdate(
						{ _id: updatedOrder._id, paymentStatus: "paid" },
						{ $set: { paymentStatus: "refunded" } },
						{ new: true }
					);
					if (refundedOrder) {
						try {
							await refundTransaction(payment.reference, updatedOrder.totalPrice * 100);
							logger.info(
								`[REFUND] Paystack refund issued for cancelled order ${updatedOrder._id}`,
							);
						} catch (refundErr) {
							logger.error(
								`[REFUND] Paystack refund failed for order ${updatedOrder._id}: ${refundErr.message}`,
							);
						}
					}
				}
			}
		} catch (error) {
			logger.error(
				`Failed to refund customer for cancelled order ${orderId}: ${error.message}`,
			);
		}
	}

	try {
		await ledgerService.reverseOrderEarnings(updatedOrder);
	} catch (error) {
		logger.error(
			`Failed to reverse ledger for cancelled order ${orderId}: ${error.message}`,
		);
	}

	try {
		await notificationService.notifyOrderCancelled(updatedOrder.vendor, updatedOrder);
		logger.info(
			`Order ${orderId} cancelled by customer ${customerId}, vendor ${updatedOrder.vendor} notified`,
		);
	} catch (error) {
		logger.error(`Failed to send cancellation notification: ${error.message}`);
	}

	if (global.io) {
		if (updatedOrder.vendor) {
			global.io.to(updatedOrder.vendor.toString()).emit("orderUpdate", {
				orderId: updatedOrder._id,
				status: updatedOrder.status,
				subStatus: updatedOrder.subStatus,
				message: "Order was cancelled by the customer.",
			});
		}
		if (updatedOrder.rider) {
			global.io.to(updatedOrder.rider.toString()).emit("orderUpdate", {
				orderId: updatedOrder._id,
				status: updatedOrder.status,
				subStatus: updatedOrder.subStatus,
				message: "Order was cancelled by the customer.",
			});
		}
	}

	return updatedOrder;
};

const vendorAcceptOrder = async (orderId, vendorId) => {
	const order = await Order.findById(orderId);
	if (!order) throw new AppError("Order not found", 404);

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
	if (!order) throw new AppError("Order not found", 404);

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
	sendOrderConfirmationEmailForOrder,
	_calculateFees,
};
