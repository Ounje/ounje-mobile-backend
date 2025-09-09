const express = require("express");
const Food = require("../models/Food");
const { authMiddleware, roleGuard } = require("../middleware/auth");

const router = express.Router();

// Create food (seller only)
router.post("/", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const { name, description, price, image } = req.body;
    const food = new Food({ name, description, price, image, seller: req.user._id });
    await food.save();
    res.json(food);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update food (seller only, must be owner)
router.put("/:id", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });

    // Ensure only the owner can update
    if (!food.seller.equals(req.user._id)) {
      return res.status(403).json({ error: "Not owner" });
    }

    // Whitelist allowed fields
    const allowedFields = ["name", "description", "price", "image"];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        food[field] = req.body[field];
      }
    });

    await food.save();
    res.json(food);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// Delete food (seller only)
router.delete("/:id", authMiddleware, roleGuard(["seller"]), async (req, res) => {
  try {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    if (!food.seller.equals(req.user._id)) return res.status(403).json({ error: "Not owner" });

    await food.deleteOne();
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Public: list and view
router.get("/", async (req, res) => {
  const foods = await Food.find({ isActive: true }).populate("seller", "name location");
  res.json(foods);
});

router.get("/:id", async (req, res) => {
  const food = await Food.findById(req.params.id).populate("seller", "name location");
  if (!food) return res.status(404).json({ error: "Not found" });
  res.json(food);
});

module.exports = router;
