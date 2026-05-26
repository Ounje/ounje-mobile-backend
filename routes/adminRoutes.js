const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");


/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Administrative Functions
 */

/**
 * @swagger
 * /api/admin/create-platform-account:
 *   post:
 *     summary: Create platform account
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Account created
 */
router.post("/create-platform-account", adminController.createPlatformAccount);

/**
 * @swagger
 * /api/admin/login:
 *   post:
 *     summary: Admin Login
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged in
 */
router.post("/login", adminController.adminLogin);

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all signed-up users (customers, vendors, riders)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Successfully retrieved all users
 */
router.get("/users", adminController.getAllUsers);

module.exports = router;