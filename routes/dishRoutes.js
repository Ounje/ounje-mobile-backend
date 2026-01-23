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

router.get("/food-items", getAllFoodItems);

router.get("/food-items/:foodItemId", getFoodItemById);

router.get(
	"/food-items/vendor/my-items",
	authMiddleware,
	roleGuard(["vendor"]),
	getMyFoodItems,
);

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
