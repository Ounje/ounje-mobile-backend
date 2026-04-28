const Promotion = require("../models/Promotion");
const { generatePromoCode } = require("../utils/codeGenerator");
logger = require("../utils/logger");

/**
 * Shared discount calculation
 */
function calculateDiscount(promo, total) {
	if (promo.type === "percentage") {
		let discount = Math.round((total * promo.value) / 100);
		if (promo.maxDiscount != null) {
			discount = Math.min(discount, promo.maxDiscount);
		}
		return discount;
	} else if (promo.type === "fixed_amount") {
		return Math.min(promo.value, total);
	}
	return 0;
}

/**
 * Shared promo validation logic (does not mutate DB)
 * Returns { error, status } if invalid, or null if valid
 */
function getPromoError(promo, userId, total) {
	if (!promo || !promo.isActive) {
		return { status: 400, message: "Invalid or inactive promo code" };
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
 * Body: { description, type, value, maxDiscount, minOrderValue, usageLimit, startsAt, expiresAt }
 * Admin-only.Create promo code on ounje kitchen
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
		} = req.body;

		// Only type and value are truly required — all other fields are optional
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
		});

		await newPromo.save();
		return res.json({ success: true, promo: newPromo });
	} catch (err) {
		console.error("createPromoCode error:", err);
		return res.status(500).json({ success: false, message: "Server error" });
	}
};

/**
 * POST /api/promo/validate
 * Body: { code, orderTotal }
 * Auth: requires req.user._id
 * Dry-run — does not mark the promo as used
 */
exports.validatePromoCode = async (req, res) => {
	try {
		const { code, orderTotal } = req.body;
		const userId = req.user._id;

		if (!code) {
			return res
				.status(400)
				.json({ success: false, message: "Promo code is required" });
		}

		const promo = await Promotion.findOne({ code: code.trim().toUpperCase() });
		const total = Number(orderTotal) || 0;

		const error = getPromoError(promo, userId, total);
		if (error) {
			return res
				.status(error.status)
				.json({ success: false, message: error.message });
		}

		const discount = calculateDiscount(promo, total);

		return res.json({
			success: true,
			valid: true,
			discount,
			type: promo.type,
			value: promo.value,
			description: promo.description,
			message: `Promo applied! You save ₦${discount.toLocaleString()}`,
		});
	} catch (err) {
		console.error("validatePromoCode error:", err);
		return res.status(500).json({ success: false, message: "Server error" });
	}
};

/**
 * POST /api/promo/apply
 * Body: { code, orderTotal }
 * Auth: requires req.user._id
 * Commits the promo — increments usedCount and records the user
 */
exports.applyPromoCode = async (req, res) => {
	try {
		const { code, orderTotal } = req.body;
		const userId = req.user._id;

		if (!code) {
			return res
				.status(400)
				.json({ success: false, message: "Promo code is required" });
		}

		const promo = await Promotion.findOne({ code: code.trim().toUpperCase() });
		const total = Number(orderTotal) || 0;

		const error = getPromoError(promo, userId, total);
		if (error) {
			return res
				.status(error.status)
				.json({ success: false, message: error.message });
		}

		const discount = calculateDiscount(promo, total);

		await Promotion.findByIdAndUpdate(promo._id, {
			$inc: { usedCount: 1 },
			$addToSet: { usedBy: userId },
		});

		return res.json({
			success: true,
			discount,
			finalTotal: Math.max(0, total - discount),
			code: promo.code,
			message: `Promo applied! You save ₦${discount.toLocaleString()}`,
		});
	} catch (err) {
		console.error("applyPromoCode error:", err);
		return res.status(500).json({ success: false, message: "Server error" });
	}
};

exports.applyReferralCode = async (req, res) => {
	try {
	} catch {}
};
