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
	addSubCategories,
	deleteSubCategory,
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
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Optional subcategories (no limit)
 *               preparationTime:
 *                 type: string
 *               minQuantity:
 *                 type: number
 *               maxQuantity:
 *                 type: number
 *               isCompulsory:
 *                 type: boolean
 *                 description: Whether customer must buy the food with ALL listed subcategories
 *               img:
 *                 type: string
 *                 format: binary
 *                 description: Main food image
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
 * /api/food-items/{foodItemId}/subcategories:
 *   patch:
 *     summary: Add subcategories to a food item
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subCategory
 *             properties:
 *               subCategory:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: One or more subcategories to add (duplicates are ignored)
 *               isCompulsory:
 *                 type: boolean
 *                 description: Whether customer must buy the food with ALL listed subcategories
 *     responses:
 *       200:
 *         description: Subcategories updated successfully
 *       400:
 *         description: Invalid subcategory
 *       404:
 *         description: Food item not found
 */
router.patch(
	"/:foodItemId/subcategories",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	addSubCategories,
);
/**
 * @swagger
 * /api/food-items/{foodItemId}/subcategories:
 *   delete:
 *     summary: Remove subcategories from a food item
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subCategory
 *             properties:
 *               subCategory:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: One or more subcategories to remove
 *     responses:
 *       200:
 *         description: Subcategories removed successfully
 *       400:
 *         description: Subcategory not found on food item
 *       404:
 *         description: Food item not found
 */
router.delete(
	"/:foodItemId/subcategories",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	deleteSubCategory,
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
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Subcategories (no limit)
 *               preparationTime:
 *                 type: string
 *               minQuantity:
 *                 type: number
 *               maxQuantity:
 *                 type: number
 *               isCompulsory:
 *                 type: boolean
 *                 description: Whether customer must buy the food with ALL listed subcategories
 *               img:
 *                 type: string
 *                 format: binary
 *                 description: Main food image
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
