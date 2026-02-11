const express = require("express");
const {
	authMiddleware,
	roleGuard,
	checkActiveUser,
} = require("../middleware/auth");
const {
	createCombo,
	updateCombo,
	deleteCombo,
	getAllCombos,
	getComboById,
	getMyCombos,
	getVendorCombos,
	getVendorCombosGrouped,
} = require("../controllers/foodItemController");
const {
	createComboGroup,
	updateComboGroup,
	deleteComboGroup,
	getVendorComboGroups,
	getMyComboGroups,
	getComboGroupById,
	manageGroupItems,
} = require("../controllers/comboGroupController");
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
	checkActiveUser,
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
 *               comboGroup:
 *                 type: string
 *                 description: ID of the combo group (optional)
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
	checkActiveUser,
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
 *               comboGroup:
 *                 type: string
 *                 description: ID of the combo group (optional)
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
	checkActiveUser,
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
	checkActiveUser,
	deleteCombo,
);

// Combo Group Routes

/**
 * @swagger
 * /api/combos/groups:
 *   post:
 *     summary: Create a combo group
 *     tags: [Combos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Group created
 */
router.post(
	"/groups",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	createComboGroup,
);

/**
 * @swagger
 * /api/combos/groups/{groupId}:
 *   put:
 *     summary: Update a combo group
 *     tags: [Combos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Group updated
 */
router.put(
	"/groups/:groupId",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	updateComboGroup,
);

/**
 * @swagger
 * /api/combos/groups/{groupId}:
 *   delete:
 *     summary: Delete a combo group
 *     tags: [Combos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group deleted
 */
router.delete(
	"/groups/:groupId",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	deleteComboGroup,
);

/**
 * @swagger
 * /api/combos/groups/{groupId}/items:
 *   post:
 *     summary: Bulk add/remove items from group
 *     tags: [Combos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               add:
 *                 type: array
 *                 items:
 *                   type: string
 *               remove:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Items updated
 */
router.post(
	"/groups/:groupId/items",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	manageGroupItems
);

/**
 * @swagger
 * /api/combos/groups/vendor/my-groups:
 *   get:
 *     summary: Get logged-in vendor's combo groups
 *     tags: [Combos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of groups
 */
router.get(
	"/groups/vendor/my-groups",
	authMiddleware,
	roleGuard(["vendor"]),
	checkActiveUser,
	getMyComboGroups,
);

/**
 * @swagger
 * /api/combos/groups/vendor/{vendorId}:
 *   get:
 *     summary: Get vendor's combo groups (public)
 *     tags: [Combos]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of groups
 */
router.get("/groups/vendor/:vendorId", getVendorComboGroups);

/**
 * @swagger
 * /api/combos/vendor/{vendorId}/grouped:
 *   get:
 *     summary: Get vendor's combos grouped by category
 *     tags: [Combos]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Grouped list of combos
 */
router.get("/vendor/:vendorId/grouped", getVendorCombosGrouped);

/**
 * @swagger
 * /api/combos/groups/{groupId}:
 *   get:
 *     summary: Get combo group details
 *     tags: [Combos]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group details
 */
router.get("/groups/:groupId", getComboGroupById);

module.exports = router;
