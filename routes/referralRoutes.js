const express = require("express");
const router = express.Router();
const { getMyReferralCode, linkReferralCode } = require("../controllers/referralController");
const { authMiddleware } = require("../middleware/auth");

// GET /api/referrals/my-code — Fetch customer's active referral code
router.get("/my-code", authMiddleware, getMyReferralCode);

// POST /api/referrals/link — Link a promo code from support/IT portal
router.post("/link", authMiddleware, linkReferralCode);

module.exports = router;
