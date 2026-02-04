// routes/ratingRoutes.js
const express = require("express");
const router = express.Router();
const { authMiddleware, roleGuard } = require("../middleware/auth");
const {
	rateFood,
	rateCombo,
	rateVendor,
	rateRider,
	getReviews,
	deleteReview,
} = require("../controllers/ratingController");

// Rate entities (customer only)
/**
 * @swagger
 * tags:
 *   name: Ratings
 *   description: Ratings and Reviews
 */

/**
 * @swagger
 * /api/rating/food/{id}:
 *   post:
 *     summary: Rate a food item
 *     tags: [Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *                 description: 1-5
 *               comment:
 *                 type: string
 *               like:
 *                 type: boolean
 *                 description: true to like, false to unlike
 *     responses:
 *       201:
 *         description: Rated successfully
 */
router.post("/food/:id", authMiddleware, roleGuard(["customer"]), rateFood);

/**
 * @swagger
 * /api/rating/combo/{id}:
 *   post:
 *     summary: Rate a combo
 *     tags: [Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *               comment:
 *                 type: string
 *               like:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Rated successfully
 */
router.post("/combo/:id", authMiddleware, roleGuard(["customer"]), rateCombo);

/**
 * @swagger
 * /api/rating/vendor/{id}:
 *   post:
 *     summary: Rate a vendor
 *     tags: [Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *               comment:
 *                 type: string
 *               like:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Rated successfully
 */
router.post("/vendor/:id", authMiddleware, roleGuard(["customer"]), rateVendor);

/**
 * @swagger
 * /api/rating/rider/{id}:
 *   post:
 *     summary: Rate a rider
 *     tags: [Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *               comment:
 *                 type: string
 *               like:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Rated successfully
 */
router.post("/rider/:id", authMiddleware, roleGuard(["customer"]), rateRider);

// Get reviews (public)
/**
 * @swagger
 * /api/rating/{targetType}/{targetId}:
 *   get:
 *     summary: Get reviews
 *     tags: [Ratings]
 *     parameters:
 *       - in: path
 *         name: targetType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [FoodItem, Combo, Vendor, Rider]
 *       - in: path
 *         name: targetId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of reviews
 */
router.get("/:targetType/:targetId", getReviews);

// Delete own review (customer only)
/**
 * @swagger
 * /api/rating/{reviewId}:
 *   delete:
 *     summary: Delete a review
 *     tags: [Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review deleted
 */
router.delete(
	"/:reviewId",
	authMiddleware,
	roleGuard(["customer"]),
	deleteReview,
);

module.exports = router;
