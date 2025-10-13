const express = require("express");
const Dish = require("../models/Dish");
const { authMiddleware, roleGuard } = require("../middleware/auth");
const { upload } = require("../config/cloudinary");
const { createDish, getDishes, getSpecificDish, deleteDish, updateDish } = require("../controllers/dishController");

const router = express.Router();


router.post("/create-dish", authMiddleware, upload.single("file") , createDish);
 


// Update dish (seller only, must be owner). This does not update image or options for now
router.put("/:id", authMiddleware, roleGuard(["seller"]), updateDish);


// Delete dish (seller only)
router.delete("/:id", authMiddleware, roleGuard(["vendor"]), deleteDish);

// Public: list and view 
router.get("/", getDishes);

router.get("/:id", getSpecificDish);

module.exports = router;
