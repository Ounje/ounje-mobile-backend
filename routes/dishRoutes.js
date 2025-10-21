const express = require("express");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { upload } = require("../config/cloudinary");
const { createDish, getDishes, getSpecificDish, deleteDish, updateDish, allItems, getFoodItemsByCategory, getFoodItemById } = require("../controllers/dishController");

const router = express.Router();


router.post("/create-dish", authMiddleware, upload.single("file") , createDish);
 
router.get("/food-items", allItems);

router.get("/food-item/:id", getFoodItemById);

router.get("/food-category/:category", getFoodItemsByCategory);



// Public: list and view 
router.get("/", getDishes);

router.get("/dish/:id", getSpecificDish);



// Update dish (seller only, must be owner). This does not update image or options for now
router.put("/dish/:id", authMiddleware, roleGuard(["seller"]), updateDish);


// Delete dish (seller only)
//authmidlleware authenticates the jwt, role guard checks if the user has the "vendor" role. The role is contained in the jwt.
router.delete("/dish/:id", authMiddleware, roleGuard(["vendor"]), deleteDish);

module.exports = router;
