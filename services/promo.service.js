const Promotion = require("../models/Promotion");

function calculateDiscount(promo, total, comboSubtotal = 0) {
	const base = promo.applicableTo === "Combo" ? comboSubtotal : total;

	if (promo.type === "percentage") {
		let discount = Math.round((base * promo.value) / 100);

		if (promo.maxDiscount != null) {
			discount = Math.min(discount, promo.maxDiscount);
		}

		return discount;
	}

	if (promo.type === "fixed_amount") {
		return Math.min(promo.value, base);
	}

	return 0;
}

function getPromoError(
	promo,
	userId,
	{ total, comboSubtotal: comboSubtotal = 0 },
) {
	if (!promo || promo.isDeleted) {
		return { status: 400, message: "Invalid promo code" };
	}

	if (!promo || promo.status !== "active") {
		return { status: 400, message: "Inactive promo code" };
	}

	const now = new Date();

	if (promo.startsAt && promo.startsAt > now) {
		return { status: 400, message: "Promo not yet valid" };
	}

	if (promo.expiresAt && promo.expiresAt < now) {
		return { status: 400, message: "Promo expired" };
	}

	if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
		return { status: 400, message: "Promo usage limit reached" };
	}

	if (promo.usedBy?.some((id) => id.toString() === userId.toString())) {
		return { status: 400, message: "Promo already used by you" };
	}

	if (promo.applicableTo === "Combo") {
		if (comboSubtotal <= 0) {
			return { status: 400, message: "Promo only valid for combo meals" };
		}
	}

	if (promo.minOrderValue && total < promo.minOrderValue) {
		return {
			status: 400,
			message: `Minimum order ₦${promo.minOrderValue.toLocaleString()} required`,
		};
	}

	return null;
}

async function findPromoByCode(code) {
	if (!code) return null;
	return Promotion.findOne({ code: code.trim().toUpperCase() });
}

module.exports = {
	calculateDiscount,
	getPromoError,
	findPromoByCode,
};
