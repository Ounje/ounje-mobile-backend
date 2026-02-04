const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const {
    createCombo,
    updateCombo,
    deleteCombo,
    getAllCombos,
    getComboById,
    getMyCombos,
    getVendorCombos,
} = require("../controllers/foodItemController");
const { comboUpload } = require("../config/cloudinary");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Combos
 *   description: Combo Meals Management
 */

/**
 * @swagger
 * /api/combos:
 *   get:
 *     summary: Get all combos
 *     tags: [Combos]
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
router.get("/", getAllCombos);

/**
 * @swagger
 * /api/combos/{comboId}:
 *   get:
 *     summary: Get combo by ID
 *     tags: [Combos]
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
router.get("/:comboId", getComboById);

/**
 * @swagger
 * /api/combos/vendor/{vendorId}:
 *   get:
 *     summary: Get combos by vendor ID
 *     tags: [Combos]
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
router.get("/vendor/:vendorId", getVendorCombos);

/**
 * @swagger
 * /api/combos/vendor/my-combos:
 *   get:
 *     summary: Get logged-in vendor's combos
 *     tags: [Combos]
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
// Specific routes before parameterized routes!
router.get(
    "/vendor/my-combos",
    authMiddleware,
    roleGuard(["vendor"]),
    getMyCombos,
);

/**
 * @swagger
 * /api/combos:
 *   post:
 *     summary: Create a combo
 *     tags: [Combos]
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
    "/",
    authMiddleware,
    roleGuard(["vendor"]),
    comboUpload.single("img"),
    createCombo,
);

/**
 * @swagger
 * /api/combos/{comboId}:
 *   put:
 *     summary: Update a combo
 *     tags: [Combos]
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
    "/:comboId",
    authMiddleware,
    roleGuard(["vendor"]),
    comboUpload.single("img"),
    updateCombo,
);

/**
 * @swagger
 * /api/combos/{comboId}:
 *   delete:
 *     summary: Delete a combo
 *     tags: [Combos]
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
    "/:comboId",
    authMiddleware,
    roleGuard(["vendor"]),
    deleteCombo,
);

module.exports = router;
