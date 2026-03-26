const express = require("express");
const router = express.Router();
const { validatePromoCode, applyPromoCode } = require("../controllers/promoController");
const { authMiddleware } = require("../middleware/auth");

// POST /api/promo/validate — check code + calculate discount (no side effects)
router.post("/validate", authMiddleware, validatePromoCode);

// POST /api/promo/apply — validate + increment usedCount
router.post("/apply", authMiddleware, applyPromoCode);

module.exports = router;
