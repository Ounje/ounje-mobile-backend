const Promotion = require("../models/Promotion");

/**
 * POST /api/promo/validate
 * Check if a promo code is valid without applying it.
 * Body: { code, orderTotal }
 * Returns: { valid, discount, type, message }
 */
exports.validatePromoCode = async (req, res) => {
	try {
		const { code, orderTotal } = req.body;

		if (!code) {
			return res.status(400).json({ success: false, message: "Promo code is required" });
		}

		const promo = await Promotion.findOne({ code: code.trim().toUpperCase() });

		if (!promo) {
			return res.status(404).json({ success: false, message: "Invalid promo code" });
		}

		if (!promo.isActive) {
			return res.status(400).json({ success: false, message: "This promo code is no longer active" });
		}

		const now = new Date();
		if (promo.startsAt && promo.startsAt > now) {
			return res.status(400).json({ success: false, message: "This promo code is not yet valid" });
		}
		if (promo.expiresAt && promo.expiresAt < now) {
			return res.status(400).json({ success: false, message: "This promo code has expired" });
		}

		if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
			return res.status(400).json({ success: false, message: "This promo code has reached its usage limit" });
		}

		const total = Number(orderTotal) || 0;
		if (total < promo.minOrderValue) {
			return res.status(400).json({
				success: false,
				message: `Minimum order value of ₦${promo.minOrderValue.toLocaleString()} required for this promo`,
			});
		}

		// Calculate discount amount
		let discount = 0;
		if (promo.type === "percentage") {
			discount = Math.round((total * promo.value) / 100);
			if (promo.maxDiscount != null) {
				discount = Math.min(discount, promo.maxDiscount);
			}
		} else if (promo.type === "fixed_amount") {
			discount = Math.min(promo.value, total);
		}

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
 * Validate the promo against the actual cart total and return confirmed discount.
 * Increments usedCount on success.
 * Body: { code, orderTotal }
 * Returns: { success, discount, finalTotal }
 */
exports.applyPromoCode = async (req, res) => {
	try {
		const { code, orderTotal } = req.body;

		if (!code) {
			return res.status(400).json({ success: false, message: "Promo code is required" });
		}

		const promo = await Promotion.findOne({ code: code.trim().toUpperCase() });

		if (!promo || !promo.isActive) {
			return res.status(400).json({ success: false, message: "Invalid or inactive promo code" });
		}

		const now = new Date();
		if (promo.expiresAt && promo.expiresAt < now) {
			return res.status(400).json({ success: false, message: "This promo code has expired" });
		}

		if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
			return res.status(400).json({ success: false, message: "This promo code has reached its usage limit" });
		}

		const total = Number(orderTotal) || 0;
		if (total < promo.minOrderValue) {
			return res.status(400).json({
				success: false,
				message: `Minimum order value of ₦${promo.minOrderValue.toLocaleString()} required`,
			});
		}

		let discount = 0;
		if (promo.type === "percentage") {
			discount = Math.round((total * promo.value) / 100);
			if (promo.maxDiscount != null) {
				discount = Math.min(discount, promo.maxDiscount);
			}
		} else if (promo.type === "fixed_amount") {
			discount = Math.min(promo.value, total);
		}

		// Increment usage count
		await Promotion.findByIdAndUpdate(promo._id, { $inc: { usedCount: 1 } });

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
