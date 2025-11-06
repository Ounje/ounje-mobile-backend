const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { createDish, getDishes, getSpecificDish, deleteDish, updateDish, allItems, getFoodItemsByCategory, getFoodItemById, createFoodItem, deleteFoodItem } = require("../controllers/dishController");
const { dishUpload, foodItemUpload } = require("../config/cloudinary");

const router = express.Router();


router.post("/create-dish", authMiddleware, dishUpload.single("file") , createDish);

router.post("/create-food-item", authMiddleware, foodItemUpload.single("file"), createFoodItem);
 
router.get("/food-items", allItems);

router.get("/food-item/:foodItemId", getFoodItemById);

router.get("/food-category/:category", getFoodItemsByCategory);



// Public: list and view 
router.get("/", getDishes);

router.get("/dish/:dishId", getSpecificDish);



// Update dish (seller only, must be owner). This does not update image or options for now
router.put("/dish/:dishId", authMiddleware, roleGuard(["seller"]), updateDish); 


// Delete dish (seller only)
//authmidlleware authenticates the jwt, role guard checks if the user has the "vendor" role. The role is contained in the jwt.
router.delete("/dish/:dishId", authMiddleware, roleGuard(["vendor"]), deleteDish);

router.delete("/food-item/:foodItemId", authMiddleware, roleGuard(["vendor"]), deleteFoodItem);

module.exports = router;
