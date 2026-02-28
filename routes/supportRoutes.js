const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { supportWhatsAppRedirect } = require("../controllers/supportController");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Support
 *   description: Support channels
 */

/**
 * @swagger
 * /api/support/whatsapp:
 *   post:
 *     summary: Create support ticket and return WhatsApp redirect URL
 *     tags: [Support]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [delivery, deactivated, updateProfile]
 *         description: Support request type
 *       - in: query
 *         name: issue
 *         schema:
 *           type: string
 *           enum: [menu, order]
 *         description: Customer-specific issue type
 *     responses:
 *       200:
 *         description: WhatsApp URL returned with created ticket ID
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Role not allowed
 *       409:
 *         description: Existing open account support ticket
 */
router.post(
	"/whatsapp",
	authMiddleware,
	roleGuard(["vendor", "rider", "customer"]),
	supportWhatsAppRedirect,
);

module.exports = router;
