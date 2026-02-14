const express = require("express");
const router = express.Router();
const {
	search,
	getSuggestions,
	searchVendors,
	searchCombos,
	searchPlates,
	searchFoodItems,
} = require("../controllers/search.controller");

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Universal search across vendors, food items, combos, and plates
 *     description: Search all items and return results grouped by type.
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: Search query
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [vendor, food, combo, plate]
 *         required: false
 *         description: Filter by type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         required: false
 *       - in: query
 *         name: includeUnavailable
 *         schema:
 *           type: boolean
 *         required: false
 *         description: Include unavailable items
 *     responses:
 *       200:
 *         description: Search results
 */

/**
 * @swagger
 * /api/search/suggestions:
 *   get:
 *     summary: Get search autocomplete suggestions
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: Partial search query (min 2 characters)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         required: false
 *     responses:
 *       200:
 *         description: List of suggestions
 */

/**
 * @swagger
 * /api/search/vendors:
 *   get:
 *     summary: Search vendors only
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: includeUnavailable
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Vendor search results
 */

/**
 * @swagger
 * /api/search/food:
 *   get:
 *     summary: Search food items only
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: includeUnavailable
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Food items search results
 */

/**
 * @swagger
 * /api/search/combos:
 *   get:
 *     summary: Search combos only
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: includeUnavailable
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Combo search results
 */

/**
 * @swagger
 * /api/search/plates:
 *   get:
 *     summary: Search plates only
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: includeUnavailable
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Plate search results
 */

router.get("/", search);
router.get("/suggestions", getSuggestions);
router.get("/vendors", searchVendors);
router.get("/food", searchFoodItems);
router.get("/combos", searchCombos);
router.get("/plates", searchPlates);

module.exports = router;
