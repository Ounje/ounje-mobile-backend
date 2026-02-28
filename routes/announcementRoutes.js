// routes/announcement.routes.js
const express = require("express");
const router = express.Router();
const { getActiveAnnouncements } = require("../controllers/announcementController");

/**
 * @swagger
 * tags:
 *   name: Announcements
 *   description: Announcement Management
 */

/**
 * @swagger
 * /api/announcements/active:
 *   get:
 *     summary: Get active announcements
 *     tags: [Announcements]
 *     responses:
 *       200:
 *         description: List of active announcements
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/active", getActiveAnnouncements);

module.exports = router;
