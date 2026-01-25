const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { supportWhatsAppRedirect } = require("../controllers/supportController");

const router = express.Router();

/**
 * Vendor & Rider WhatsApp Support
 * GET api/support/whatsapp
 */
/**
 * @swagger
 * tags:
 *   name: Support
 *   description: Support channels
 */

/**
 * @swagger
 * /api/support/whatsapp:
 *   get:
 *     summary: Redirect to WhatsApp support
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       302:
 *         description: Redirects to WhatsApp
 */
router.get(
	"/whatsapp",
	authMiddleware,
	roleGuard(["vendor", "rider"]),
	supportWhatsAppRedirect,
);

module.exports = router;
