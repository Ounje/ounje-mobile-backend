const express = require("express");
const Dish = require("../models/Dish");
const { authMiddleware, roleGuard } = require("../middleware/auth");

const router = express.Router();

// Create dish (seller only)
router.post("/", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const { name, description, price, image } = req.body;
    const dish = new Dish({ name, description, price, image, seller: req.user._id });
    await dish.save();
    res.json(dish);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
 


// Update dish (seller only, must be owner)
router.put("/:id", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const dish = await Dish.findById(req.params.id);
    if (!dish) return res.status(404).json({ error: "dish not found" });

    // Ensure only the owner can update
    if (!dish.seller.equals(req.user._id)) {
      return res.status(403).json({ error: "Not owner" });
    }

    // Whitelist allowed fields
    const allowedFields = ["name", "description", "price", "image"];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        dish[field] = req.body[field];
      }
    });

    await dish.save();
    res.json(dish);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// Delete dish (seller only)
router.delete("/:id", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const dish = await Dish.findById(req.params.id);
    if (!dish) return res.status(404).json({ error: "dish not found" });
    if (!dish.seller.equals(req.user._id)) return res.status(403).json({ error: "Not owner" });

    await dish.deleteOne();
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Public: list and view
router.get("/", async (req, res) => {
  const dishs = await Dish.find({ isActive: true }).populate("seller", "name location");
  res.json(dishs);
});

router.get("/:id", async (req, res) => {
  const dish = await Dish.findById(req.params.id).populate("seller", "name location");
  if (!dish) return res.status(404).json({ error: "Not found" });
  res.json(dish);
});

module.exports = router;
