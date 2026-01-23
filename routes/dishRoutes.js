const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const {
	createFoodItem,
	updateFoodItem,
	deleteFoodItem,
	getAllFoodItems,
	getFoodItemById,
	getMyFoodItems,

	createCombo,
	updateCombo,
	deleteCombo,
	getAllCombos,
	getComboById,
	getMyCombos,
	getVendorCombos,
} = require("../controllers/dishController");
const { foodItemUpload, comboUpload } = require("../config/cloudinary");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Dishes
 *   description: Food Items and Combos Management
 */

/**
 * @swagger
 * /api/dishes/food-items:
 *   get:
 *     summary: Get all food items
 *     tags: [Dishes]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of food items
 */
router.get("/food-items", getAllFoodItems);

/**
 * @swagger
 * /api/dishes/food-items/{foodItemId}:
 *   get:
 *     summary: Get food item by ID
 *     tags: [Dishes]
 *     parameters:
 *       - in: path
 *         name: foodItemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Food item details
 *       404:
 *         description: Food item not found
 */
router.get("/food-items/:foodItemId", getFoodItemById);

router.get(
	"/food-items/vendor/my-items",
	authMiddleware,
	roleGuard(["vendor"]),
	getMyFoodItems,
);

/**
 * @swagger
 * /api/dishes/food-items:
 *   post:
 *     summary: Create a food item
 *     tags: [Dishes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *               - category
 *               - preparationTime
 *               - img
 *             properties:
 *               name:
 *                 type: string
 *               price:
 *                 type: number
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               subCategory:
 *                 type: string
 *               preparationTime:
 *                 type: string
 *               img:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Food item created successfully
 *       400:
 *         description: Missing fields or invalid data
 *       403:
 *         description: Vendor profile incomplete
 */
router.post(
	"/food-items",
	authMiddleware,
	roleGuard(["vendor"]),
	foodItemUpload.single("img"),
	createFoodItem,
);

router.put(
	"/food-items/:foodItemId",
	authMiddleware,
	roleGuard(["vendor"]),
	foodItemUpload.single("img"),
	updateFoodItem,
);

router.delete(
	"/food-items/:foodItemId",
	authMiddleware,
	roleGuard(["vendor"]),
	deleteFoodItem,
);

/**
 * @swagger
 * /api/dishes/combos:
 *   get:
 *     summary: Get all combos
 *     tags: [Dishes]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of combos
 */
router.get("/combos", getAllCombos);

router.get("/combos/:comboId", getComboById);
router.get("/:vendorId/combos", getVendorCombos);
router.get(
	"/combos/vendor/my-combos",
	authMiddleware,
	roleGuard(["vendor"]),
	getMyCombos,
);

router.post(
	"/combos",
	authMiddleware,
	roleGuard(["vendor"]),
	comboUpload.single("img"),
	createCombo,
);

router.put(
	"/combos/:comboId",
	authMiddleware,
	roleGuard(["vendor"]),
	comboUpload.single("img"),
	updateCombo,
);

router.delete(
	"/combos/:comboId",
	authMiddleware,
	roleGuard(["vendor"]),
	deleteCombo,
);

module.exports = router;
