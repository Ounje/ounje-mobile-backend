const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { supportWhatsAppRedirect } = require("../controllers/supportController");

const router = express.Router();

/**
 * Vendor & Rider WhatsApp Support
 * GET api/support/whatsapp
 */
router.get(
	"/whatsapp",
	authMiddleware,
	roleGuard(["vendor", "rider"]),
	supportWhatsAppRedirect,
);

module.exports = router;
