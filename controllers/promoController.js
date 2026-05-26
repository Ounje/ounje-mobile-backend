const Promotion = require("../models/Promotion");
const { generatePromoCode } = require("../utils/codeGenerator");
const logger = require("../utils/logger");

/**
 * Shared discount calculation.
 * When applicableTo === "combo", discount is applied only to the combo subtotal.
 * comboTotal must be passed in for combo-restricted promos.
 */
function calculateDiscount(promo, total, comboTotal = 0) {
	const base = promo.applicableTo === "combo" ? comboTotal : total;

	if (promo.type === "percentage") {
		let discount = Math.round((base * promo.value) / 100);
		if (promo.maxDiscount != null) {
			discount = Math.min(discount, promo.maxDiscount);
		}
		return discount;
	} else if (promo.type === "fixed_amount") {
		return Math.min(promo.value, base);
	}
	return 0;
}

/**
 * Shared promo validation logic (does not mutate DB).
 * Returns { error, status } if invalid, or null if valid.
 */
function getPromoError(promo, userId, total) {
	if (!promo) {
		return { status: 400, message: "Invalid promo code" };
	}
	if (promo.status === "pending_approval") {
		return { status: 400, message: "This promo code is pending approval" };
	}
	if (promo.status === "declined") {
		return { status: 400, message: "This promo code was declined" };
	}
	if (!promo.isActive || promo.status === "inactive") {
		return { status: 400, message: "This promo code is currently inactive" };
	}

	const now = new Date();
	if (promo.startsAt && promo.startsAt > now) {
		return { status: 400, message: "This promo code is not yet valid" };
	}
	if (promo.expiresAt && promo.expiresAt < now) {
		return { status: 400, message: "This promo code has expired" };
	}
	if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
		return {
			status: 400,
			message: "This promo code has reached its usage limit",
		};
	}

	const alreadyUsed = promo.usedBy.some(
		(id) => id.toString() === userId.toString(),
	);
	if (alreadyUsed) {
		return { status: 400, message: "You have already used this promo code" };
	}

	if (total < promo.minOrderValue) {
		return {
			status: 400,
			message: `Minimum order value of ₦${promo.minOrderValue.toLocaleString()} required for this promo`,
		};
	}

	return null;
}

/**
 * POST /api/promo/create
 * Admin-only. Creates a promo code.
 * Body: { description, type, value, maxDiscount, minOrderValue, usageLimit, startsAt, expiresAt, applicableTo }
 */
exports.createPromoCode = async (req, res) => {
	try {
		const {
			description,
			type,
			value,
			maxDiscount,
			minOrderValue,
			usageLimit,
			startsAt,
			expiresAt,
			applicableTo,
		} = req.body;

		if (!type || !value) {
			return res
				.status(400)
				.json({ success: false, message: "type and value are required" });
		}

		if (!["percentage", "fixed_amount"].includes(type)) {
			return res.status(400).json({
				success: false,
				message: "type must be 'percentage' or 'fixed_amount'",
			});
		}

		if (applicableTo && !["all", "combo"].includes(applicableTo)) {
			return res.status(400).json({
				success: false,
				message: "applicableTo must be 'all' or 'combo'",
			});
		}

		const code = generatePromoCode();
		const newPromo = new Promotion({
			code,
			description,
			type,
			value,
			maxDiscount,
			minOrderValue,
			usageLimit,
			startsAt,
			expiresAt,
			applicableTo: applicableTo || "all",
		});

		await newPromo.save();
		return res.json({ success: true, promo: newPromo });
	} catch (err) {
		logger.error("createPromoCode error:", err);
		return res.status(500).json({ success: false, message: "Server error" });
	}
};

/**
 * POST /api/promo/validate
 * Body: { code, orderTotal, comboTotal }
 * Dry-run — does not mark the promo as used.
 * comboTotal is required when the promo is combo-restricted.
 */
exports.validatePromoCode = async (req, res) => {
	try {
		const { code, orderTotal, comboTotal = 0 } = req.body;
		const userId = req.user._id;

		if (!code) {
			return res
				.status(400)
				.json({ success: false, message: "Promo code is required" });
		}

		const promo = await Promotion.findOne({ code: code.trim().toUpperCase() });
		const total = Number(orderTotal) || 0;
		const comboSubtotal = Number(comboTotal) || 0;

		// If promo is combo-only but no combo items in cart, reject early
		if (promo?.applicableTo === "combo" && comboSubtotal === 0) {
			return res.status(400).json({
				success: false,
				message: "This promo code is only valid for combo meals",
			});
		}

		const error = getPromoError(promo, userId, total);
		if (error) {
			return res
				.status(error.status)
				.json({ success: false, message: error.message });
		}

		const discount = calculateDiscount(promo, total, comboSubtotal);

		return res.json({
			success: true,
			valid: true,
			discount,
			type: promo.type,
			value: promo.value,
			applicableTo: promo.applicableTo,
			description: promo.description,
			message: `Promo applied! You save ₦${discount.toLocaleString()}`,
		});
	} catch (err) {
		logger.error("validatePromoCode error:", err);
		return res.status(500).json({ success: false, message: "Server error" });
	}
};

/**
 * POST /api/promo/apply
 * Body: { code, orderTotal, comboTotal }
 * Commits the promo — increments usedCount and records the user.
 */
exports.applyPromoCode = async (req, res) => {
	try {
		const { code, orderTotal, comboTotal = 0 } = req.body;
		const userId = req.user._id;

		if (!code) {
			return res
				.status(400)
				.json({ success: false, message: "Promo code is required" });
		}

		const promo = await Promotion.findOne({ code: code.trim().toUpperCase() });
		const total = Number(orderTotal) || 0;
		const comboSubtotal = Number(comboTotal) || 0;

		if (promo?.applicableTo === "combo" && comboSubtotal === 0) {
			return res.status(400).json({
				success: false,
				message: "This promo code is only valid for combo meals",
			});
		}

		const error = getPromoError(promo, userId, total);
		if (error) {
			return res
				.status(error.status)
				.json({ success: false, message: error.message });
		}

		const discount = calculateDiscount(promo, total, comboSubtotal);

		await Promotion.findByIdAndUpdate(promo._id, {
			$inc: { usedCount: 1 },
			$addToSet: { usedBy: userId },
		});

		return res.json({
			success: true,
			discount,
			finalTotal: Math.max(0, total - discount),
			code: promo.code,
			applicableTo: promo.applicableTo,
			message: `Promo applied! You save ₦${discount.toLocaleString()}`,
		});
	} catch (err) {
		logger.error("applyPromoCode error:", err);
		return res.status(500).json({ success: false, message: "Server error" });
	}
};

exports.applyReferralCode = async (req, res) => {
	try {
	} catch {}
};

module.exports = {
	getPromoError,
	calculateDiscount,
	createPromoCode: exports.createPromoCode,
	validatePromoCode: exports.validatePromoCode,
	applyPromoCode: exports.applyPromoCode,
	applyReferralCode: exports.applyReferralCode,
};
