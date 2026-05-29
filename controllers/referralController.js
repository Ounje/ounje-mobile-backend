const Referral = require("../models/referralCode");
const Promotion = require("../models/Promotion");
const User = require("../models/User");
const logger = require("../utils/logger");

/**
 * Get the logged-in customer's active referral code details and stats.
 * GET /api/referrals/my-code
 */
exports.getMyReferralCode = async (req, res) => {
	try {
		const userId = req.user.id || req.user._id;

		const referral = await Referral.findOne({ referrer: userId }).lean();
		if (!referral) {
			return res.json({
				success: true,
				hasCode: false,
				referral: null,
			});
		}

		res.json({
			success: true,
			hasCode: true,
			referral: {
				code: referral.code,
				successfulReferrals: referral.successfulReferrals || 0,
				totalEarnings: (referral.successfulReferrals || 0) * 200,
				isActive: referral.isActive,
			},
		});
	} catch (err) {
		logger.error(`Get My Referral Code Error: ${err.message}`);
		res.status(500).json({ success: false, message: "Error fetching referral code details" });
	}
};

/**
 * Link/Activate a promo code from the IT Portal as the customer's personal referral code.
 * POST /api/referrals/link
 */
exports.linkReferralCode = async (req, res) => {
	try {
		const userId = req.user.id || req.user._id;
		const { code } = req.body;

		if (!code || typeof code !== "string" || !code.trim()) {
			return res.status(400).json({ success: false, message: "Referral code is required" });
		}

		const formattedCode = code.trim().toUpperCase();

		// 1. Verify code exists in promotions (or referrals)
		const promoExists = await Promotion.findOne({ code: formattedCode }).lean();
		const refDocument = await Referral.findOne({ code: formattedCode });

		if (!promoExists && !refDocument) {
			return res.status(404).json({
				success: false,
				message: "Invalid referral code. Please request one from support.",
			});
		}

		// 2. Check if this user already has any referral code linked to their profile
		const userAlreadyHasCode = await Referral.findOne({ referrer: userId });
		if (userAlreadyHasCode) {
			return res.status(400).json({
				success: false,
				message: `You already have an active referral code: ${userAlreadyHasCode.code}`,
			});
		}

		// 3. Handle linking/claiming
		if (refDocument) {
			if (refDocument.referrer) {
				if (refDocument.referrer.toString() === userId.toString()) {
					return res.json({
						success: true,
						message: "Referral code is already linked to your account",
						referral: refDocument,
					});
				}
				return res.status(400).json({
					success: false,
					message: "This referral code has already been claimed by another user.",
				});
			}

			// Unclaimed referral document — assign to this user
			refDocument.referrer = userId;
			await refDocument.save();
			return res.json({
				success: true,
				message: "Referral code linked successfully!",
				referral: refDocument,
			});
		} else {
			// No referral document exists yet, but it's a valid promo code from the promotions collection
			const newReferral = new Referral({
				referrer: userId,
				code: formattedCode,
				referredUsers: [],
				successfulReferrals: 0,
				isActive: true,
			});

			await newReferral.save();
			return res.json({
				success: true,
				message: "Referral code activated successfully!",
				referral: newReferral,
			});
		}
	} catch (err) {
		logger.error(`Link Referral Code Error: ${err.message}`);
		res.status(500).json({ success: false, message: err.message || "Error linking referral code" });
	}
};
