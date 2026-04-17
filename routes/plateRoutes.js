const express = require("express");

const {
	buildPlate,
	getAllPlates,
	getPopularPlates,
	getSpecificPlate,
	deletePlate,
	fixAllPlates,
} = require("../controllers/plateController");

const { roleGuard, authMiddleware } = require("../middleware/auth");
const { plateUpload } = require("../config/cloudinary");
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Plates
 *   description: Custom Plate Building
 */

/**
 * @swagger
 * /api/plates/build-plate:
 *   post:
 *     summary: Build a custom plate
 *     tags: [Plates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               name:
 *                 type: string
 *               vendor:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Plate created
 */
router.post(
	"/build-plate",
	authMiddleware,
	plateUpload.fields([{ name: "file", maxCount: 1 }]),
	buildPlate,
);

/**
 * @swagger
 * /api/plates/get-plates:
 *   get:
 *     summary: Get all plates
 *     tags: [Plates]
 *     responses:
 *       200:
 *         description: List of plates
 */
router.get("/get-plates", getAllPlates);
router.get("/popular", getPopularPlates);

/**
 * @swagger
 * /api/plates/plate/{plateId}:
 *   get:
 *     summary: Get specific plate
 *     tags: [Plates]
 *     parameters:
 *       - in: path
 *         name: plateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plate details
 */
router.get("/plate/:plateId", getSpecificPlate);

/**
 * @swagger
 * /api/plates/plate/{plateId}:
 *   delete:
 *     summary: Delete a plate
 *     tags: [Plates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plate deleted
 */
router.delete(
	"/plate/:plateId",
	authMiddleware,
	roleGuard(["customer"]),
	deletePlate,
);

router.get("/fix-data", fixAllPlates);

module.exports = router;
