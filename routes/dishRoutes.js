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

/**
 * @swagger
 * /api/dishes/food-items/vendor/my-items:
 *   get:
 *     summary: Get logged-in vendor's food items
 *     tags: [Dishes]
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

/**
 * @swagger
 * /api/dishes/food-items/{foodItemId}:
 *   put:
 *     summary: Update a food item
 *     tags: [Dishes]
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
 *               isAvailable:
 *                 type: boolean
 *               img:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Food item updated
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Food item not found
 */
router.put(
	"/food-items/:foodItemId",
	authMiddleware,
	roleGuard(["vendor"]),
	foodItemUpload.single("img"),
	updateFoodItem,
);

/**
 * @swagger
 * /api/dishes/food-items/{foodItemId}:
 *   delete:
 *     summary: Delete a food item
 *     tags: [Dishes]
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

/**
 * @swagger
 * /api/dishes/combos/{comboId}:
 *   get:
 *     summary: Get combo by ID
 *     tags: [Dishes]
 *     parameters:
 *       - in: path
 *         name: comboId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Combo details
 *       404:
 *         description: Combo not found
 */
router.get("/combos/:comboId", getComboById);

/**
 * @swagger
 * /api/dishes/{vendorId}/combos:
 *   get:
 *     summary: Get combos by vendor ID
 *     tags: [Dishes]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: List of vendor's combos
 *       404:
 *         description: Vendor not found
 */
router.get("/:vendorId/combos", getVendorCombos);
/**
 * @swagger
 * /api/dishes/combos/vendor/my-combos:
 *   get:
 *     summary: Get logged-in vendor's combos
 *     tags: [Dishes]
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
 *         description: List of vendor's combos
 *       403:
 *         description: Unauthorized
 */
router.get(
	"/combos/vendor/my-combos",
	authMiddleware,
	roleGuard(["vendor"]),
	getMyCombos,
);

/**
 * @swagger
 * /api/dishes/combos:
 *   post:
 *     summary: Create a combo
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
 *               - comboName
 *               - basePrice
 *               - time
 *               - img
 *             properties:
 *               comboName:
 *                 type: string
 *               description:
 *                 type: string
 *               basePrice:
 *                 type: number
 *               time:
 *                 type: string
 *               deliveryTime:
 *                 type: string
 *               selections:
 *                 type: string
 *                 description: JSON string of selections
 *               img:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Combo created
 *       400:
 *         description: Missing fields or invalid data
 *       403:
 *         description: Vendor profile incomplete
 */
router.post(
	"/combos",
	authMiddleware,
	roleGuard(["vendor"]),
	comboUpload.single("img"),
	createCombo,
);

/**
 * @swagger
 * /api/dishes/combos/{comboId}:
 *   put:
 *     summary: Update a combo
 *     tags: [Dishes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: comboId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               comboName:
 *                 type: string
 *               description:
 *                 type: string
 *               basePrice:
 *                 type: number
 *               time:
 *                 type: string
 *               deliveryTime:
 *                 type: string
 *               selections:
 *                 type: string
 *                 description: JSON string of selections
 *               img:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Combo updated
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Combo not found
 */
router.put(
	"/combos/:comboId",
	authMiddleware,
	roleGuard(["vendor"]),
	comboUpload.single("img"),
	updateCombo,
);

/**
 * @swagger
 * /api/dishes/combos/{comboId}:
 *   delete:
 *     summary: Delete a combo
 *     tags: [Dishes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: comboId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Combo deleted
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Combo not found
 */
router.delete(
	"/combos/:comboId",
	authMiddleware,
	roleGuard(["vendor"]),
	deleteCombo,
);

module.exports = router;
