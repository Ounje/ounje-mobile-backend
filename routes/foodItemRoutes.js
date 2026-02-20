const express = require("express");
const {
	authMiddleware,
	roleGuard,
	checkActiveUser,
} = require("../middleware/auth");

const {
	createFoodItem,
	updateFoodItem,
	deleteFoodItem,
	getAllFoodItems,
	getFoodItemById,
	getMyFoodItems,
} = require("../controllers/foodItemController");

const { foodItemUpload } = require("../config/cloudinary");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: FoodItems
 *   description: Food Items Management
 */

/**
 * @swagger
 * /api/food-items:
 *   get:
 *     summary: Get all food items
 *     tags: [FoodItems]
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
router.get("/", getAllFoodItems);

/**
 * @swagger
 * /api/food-items/{foodItemId}:
 *   get:
 *     summary: Get food item by ID
 *     tags: [FoodItems]
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
router.get("/:foodItemId", getFoodItemById);

/**
 * @swagger
 * /api/food-items/vendor/my-items:
 *   get:
 *     summary: Get logged-in vendor's food items
 *     tags: [FoodItems]
 *     security:
 *       - bearerAuth: []
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
 *         description: List of vendor's food items
 *       403:
 *         description: Unauthorized
 */
router.get(
	"/vendor/my-items",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	getMyFoodItems,
);

/**
 * @swagger
 * /api/food-items:
 *   post:
 *     summary: Create a food item
 *     tags: [FoodItems]
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
 *               - sideImage
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
 *               minQuantity:
 *                 type: number
 *               maxQuantity:
 *                 type: number
 *               isCompulsory:
 *                 type: boolean
 *                 description: Whether subcategory must be purchased
 *               img:
 *                 type: string
 *                 format: binary
 *                 description: Main food image
 *               sideImage:
 *                 type: string
 *                 format: binary
 *                 description: Subcategory image
 *     responses:
 *       201:
 *         description: Food item created successfully
 *       400:
 *         description: Missing fields or invalid data
 *       403:
 *         description: Vendor profile incomplete
 */
router.post(
	"/",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	foodItemUpload,
	createFoodItem,
);

/**
 * @swagger
 * /api/food-items/{foodItemId}:
 *   put:
 *     summary: Update a food item
 *     tags: [FoodItems]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: foodItemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
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
 *               minQuantity:
 *                 type: number
 *               maxQuantity:
 *                 type: number
 *               isCompulsory:
 *                 type: boolean
 *               img:
 *                 type: string
 *                 format: binary
 *                 description: Main food image
 *               sideImage:
 *                 type: string
 *                 format: binary
 *                 description: Subcategory image
 *     responses:
 *       200:
 *         description: Food item updated
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Food item not found
 */
router.put(
	"/:foodItemId",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	foodItemUpload,
	updateFoodItem,
);

/**
 * @swagger
 * /api/food-items/{foodItemId}:
 *   delete:
 *     summary: Delete a food item
 *     tags: [FoodItems]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: foodItemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Food item deleted
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Food item not found
 */
router.delete(
	"/:foodItemId",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	deleteFoodItem,
);

module.exports = router;
