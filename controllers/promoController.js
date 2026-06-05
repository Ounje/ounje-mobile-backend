const Promotion = require("../models/Promotion");
const { generatePromoCode } = require("../utils/codeGenerator");
const promoService = require("../services/promo.service");
const logger = require("../utils/logger");

exports.createPromoCode = async (req, res) => {
	try {
		const promo = new Promotion({
			...req.body,
			code: generatePromoCode(),
		});

		await promo.save();

		res.json({ success: true, promo });
	} catch (err) {
		logger.error(err);
		res.status(500).json({ success: false });
	}
};

exports.validatePromoCode = async (req, res) => {
	try {
		const { code, orderTotal, comboSubtotal = 0 } = req.body;
		const userId = req.user._id;

		const promo = await promoService.findPromoByCode(code);

		const error = promoService.getPromoError(promo, userId, {
			total: Number(orderTotal),
			comboSubtotal: Number(comboSubtotal),
		});

		if (error) {
			return res.status(error.status).json({
				success: false,
				message: error.message,
			});
		}

		const discount = promoService.calculateDiscount(
			promo,
			orderTotal,
			comboSubtotal,
		);

		res.json({
			success: true,
			discount,
			promo,
		});
	} catch (err) {
		logger.error(err);
		res.status(500).json({ success: false });
	}
};

exports.applyPromoCode = async (req, res) => {
	try {
		const { code, orderTotal, comboSubtotal = 0 } = req.body;
		const userId = req.user._id;

		const promo = await promoService.findPromoByCode(code);

		const error = promoService.getPromoError(promo, userId, {
			total: Number(orderTotal),
			comboSubtotal: Number(comboSubtotal),
		});

		if (error) {
			return res.status(error.status).json({
				success: false,
				message: error.message,
			});
		}

		const discount = promoService.calculateDiscount(
			promo,
			orderTotal,
			comboSubtotal,
		);

		await Promotion.findByIdAndUpdate(promo._id, {
			$inc: { usedCount: 1 },
			$addToSet: { usedBy: userId },
		});

		res.json({
			success: true,
			discount,
			finalTotal: Math.max(0, orderTotal - discount),
		});
	} catch (err) {
		logger.error(err);
		res.status(500).json({ success: false });
	}
};
