const searchService = require("../services/search.service");
const logger = require("../utils/logger");

/**
 * Universal search endpoint
 * GET /api/search?q=jollof&type=combo&limit=20&page=1
 */
const search = async (req, res) => {
	try {
		const { q, type, limit = 20, page = 1, includeUnavailable } = req.query;

		if (!q || q.trim().length === 0) {
			return res.status(400).json({
				error: "Search query is required",
				message: "Please provide a search term using the 'q' parameter",
			});
		}

		const options = {
			limit: parseInt(limit),
			page: parseInt(page),
			type: type || null, // 'vendor', 'food', 'combo', 'plate', or null for all
			includeUnavailable: includeUnavailable === "true",
		};

		const results = await searchService.universalSearch(q, options);

		res.json({
			success: true,
			...results,
		});
	} catch (error) {
		logger.error(`Search controller error: ${error.message}`);
		res.status(500).json({
			error: "Search failed",
			message: error.message,
		});
	}
};

/**
 * Get search suggestions (autocomplete)
 * GET /api/search/suggestions?q=jol&limit=10
 */
const getSuggestions = async (req, res) => {
	try {
		const { q, limit = 10 } = req.query;

		if (!q || q.trim().length < 2) {
			return res.json({
				success: true,
				suggestions: [],
				message: "Query too short. Minimum 2 characters required.",
			});
		}

		const suggestions = await searchService.getSearchSuggestions(
			q,
			parseInt(limit),
		);

		res.json({
			success: true,
			suggestions,
			query: q,
		});
	} catch (error) {
		logger.error(`Search suggestions error: ${error.message}`);
		res.status(500).json({
			error: "Failed to get suggestions",
			message: error.message,
		});
	}
};

/**
 * Search vendors only
 * GET /api/search/vendors?q=iya&limit=20
 */
const searchVendors = async (req, res) => {
	try {
		const { q, limit = 20, includeUnavailable } = req.query;

		if (!q || q.trim().length === 0) {
			return res.status(400).json({ error: "Search query is required" });
		}

		const vendors = await searchService.searchVendors(
			q,
			parseInt(limit),
			includeUnavailable === "true",
		);

		res.json({
			success: true,
			results: vendors,
			total: vendors.length,
			query: q,
		});
	} catch (error) {
		logger.error(`Vendor search error: ${error.message}`);
		res.status(500).json({
			error: "Vendor search failed",
			message: error.message,
		});
	}
};

/**
 * Search food items only
 * GET /api/search/food?q=rice&limit=20
 */
const searchFoodItems = async (req, res) => {
	try {
		const { q, limit = 20, includeUnavailable } = req.query;

		if (!q || q.trim().length === 0) {
			return res.status(400).json({ error: "Search query is required" });
		}

		const foods = await searchService.searchFoodItems(
			q,
			parseInt(limit),
			includeUnavailable === "true",
		);

		res.json({
			success: true,
			results: foods,
			total: foods.length,
			query: q,
		});
	} catch (error) {
		logger.error(`Food item search error: ${error.message}`);
		res.status(500).json({
			error: "Food item search failed",
			message: error.message,
		});
	}
};

/**
 * Search combos only
 * GET /api/search/combos?q=rice&limit=20
 */
const searchCombos = async (req, res) => {
	try {
		const { q, limit = 20, includeUnavailable } = req.query;

		if (!q || q.trim().length === 0) {
			return res.status(400).json({ error: "Search query is required" });
		}

		const combos = await searchService.searchCombos(
			q,
			parseInt(limit),
			includeUnavailable === "true",
		);

		res.json({
			success: true,
			results: combos,
			total: combos.length,
			query: q,
		});
	} catch (error) {
		logger.error(`Combo search error: ${error.message}`);
		res.status(500).json({
			error: "Combo search failed",
			message: error.message,
		});
	}
};

/**
 * Search plates only
 * GET /api/search/plates?q=rice&limit=20
 */
const searchPlates = async (req, res) => {
	try {
		const { q, limit = 20, includeUnavailable } = req.query;

		if (!q || q.trim().length === 0) {
			return res.status(400).json({ error: "Search query is required" });
		}

		const plates = await searchService.searchPlates(
			q,
			parseInt(limit),
			includeUnavailable === "true",
		);

		res.json({
			success: true,
			results: plates,
			total: plates.length,
			query: q,
		});
	} catch (error) {
		logger.error(`Plate search error: ${error.message}`);
		res.status(500).json({
			error: "Plate search failed",
			message: error.message,
		});
	}
};

module.exports = {
	search,
	getSuggestions,
	searchVendors,
	searchFoodItems,
	searchCombos,
	searchPlates,
};
