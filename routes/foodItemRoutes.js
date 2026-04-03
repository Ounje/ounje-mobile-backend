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
	getFoodByCategory,
	getVendorsByCategory,
	addSubCategories,
	deleteSubCategory,
	toggleFoodItemAvailability,
} = require("../controllers/foodItemController");
const {
	getCategoryValues,
	getSubCategoryValues,
	getCategorySubCategoryMap,
} = require("../utils/foodEnums");

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
 * /api/food-items/enums:
 *   get:
 *     summary: Get all food categories and sub-categories
 *     tags: [FoodItems]
 *     responses:
 *       200:
 *         description: Successfully retrieved food enums
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 categories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                         example: "Meat"
 *                       value:
 *                         type: string
 *                         example: "meat"
 *                 subCategories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                         example: "Chicken"
 *                       value:
 *                         type: string
 *                         example: "chicken"
 *       500:
 *         description: Internal server error
 */
router.get("/enums", (req, res) => {
	try {
		const categories = getCategoryValues().map((value) => ({
			label: value.charAt(0).toUpperCase() + value.slice(1),
			value,
		}));

		const subCategories = getSubCategoryValues().map((value) => ({
			label: value.charAt(0).toUpperCase() + value.slice(1),
			value,
		}));

		res.json({ categories, subCategories });
	} catch (error) {
		res.status(500).json({ message: "Internal server error" });
	}
});

/**
 * @swagger
 * /api/food-items/enums/categories:
 *   get:
 *     summary: Get all food categories
 *     tags: [FoodItems]
 *     responses:
 *       200:
 *         description: Successfully retrieved food categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 categories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                         example: "Meat"
 *                       value:
 *                         type: string
 *                         example: "meat"
 *       500:
 *         description: Internal server error
 */
router.get("/enums/categories", (req, res) => {
	try {
		const categories = getCategoryValues().map((value) => ({
			label: value.charAt(0).toUpperCase() + value.slice(1),
			value,
		}));

		res.json({ categories });
	} catch (error) {
		res.status(500).json({ message: "Internal server error" });
	}
});

/**
 * @swagger
 * /api/food-items/enums/sub-categories:
 *   get:
 *     summary: Get all food sub-categories
 *     tags: [FoodItems]
 *     responses:
 *       200:
 *         description: Successfully retrieved food sub-categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 subCategories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                         example: "Chicken"
 *                       value:
 *                         type: string
 *                         example: "chicken"
 *       500:
 *         description: Internal server error
 */
router.get("/enums/sub-categories", (req, res) => {
	try {
		res.json(getCategorySubCategoryMap());
	} catch (error) {
		res.status(500).json({ message: "Internal server error" });
	}
});

/**
 * @swagger
 * /api/food-items:
 *   post:
 *     summary: Create a food item with one or more subcategories and items
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
 *               - category
 *               - subCategories[0][name]
 *               - subCategories[0][items][0][name]
 *               - subCategories[0][items][0][price]
 *               - subCategories[0][items][0][preparationTime]
 *               - img
 *             properties:
 *               category:
 *                 type: string
 *               isCompulsory:
 *                 type: boolean
 *                 description: Whether customer must pick from subcategory items
 *               subCategories[0][name]:
 *                 type: string
 *                 description: First subcategory group name e.g. "Meat"
 *               subCategories[0][items][0][name]:
 *                 type: string
 *                 description: First item name e.g. "Goat Meat"
 *               subCategories[0][items][0][price]:
 *                 type: number
 *               subCategories[0][items][0][description]:
 *                 type: string
 *               subCategories[0][items][0][preparationTime]:
 *                 type: string
 *               subCategories[0][items][0][minQuantity]:
 *                 type: number
 *               subCategories[0][items][0][maxQuantity]:
 *                 type: number
 *               subCategories[1][name]:
 *                 type: string
 *                 description: Second subcategory group name e.g. "Rice" (optional)
 *               subCategories[1][items][0][name]:
 *                 type: string
 *                 description: Second subcategory first item name (optional)
 *               subCategories[1][items][0][price]:
 *                 type: number
 *               subCategories[1][items][0][preparationTime]:
 *                 type: string
 *               img:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: >
 *                   Images in order matching each item across all subcategories.
 *                   img[0] = subCategories[0][items][0],
 *                   img[1] = subCategories[0][items][1],
 *                   img[2] = subCategories[1][items][0] and so on.
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
// Public: get individual food items for a category (e.g. ?category=rice)
router.get("/by-category", getFoodByCategory);
// Public: get vendors that have food items in a category
router.get("/vendors-by-category", getVendorsByCategory);

router.get("/:foodItemId", getFoodItemById);

/**
 * @swagger
 * /api/food-items/{foodItemId}/subcategories:
 *   patch:
 *     summary: Add more subcategory items to an existing food item
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - subCategoryName
 *               - itemName
 *               - price
 *               - preparationTime
 *               - img
 *             properties:
 *               subCategoryName:
 *                 type: string
 *                 description: Subcategory group e.g. "Meat" (if exists, item is added under it)
 *               itemName:
 *                 type: string
 *                 description: Item name e.g. "Fish"
 *               price:
 *                 type: number
 *               description:
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
 *                 description: Item image
 *     responses:
 *       200:
 *         description: Item added to subcategory successfully
 *       400:
 *         description: Invalid subcategory or missing fields
 *       404:
 *         description: Food item not found
 */
router.patch(
	"/:foodItemId/subcategories",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	foodItemUpload,
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
 *                 description: Subcategories
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

router.patch(
	"/:foodItemId/availability",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	toggleFoodItemAvailability,
);

module.exports = router;
