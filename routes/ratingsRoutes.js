const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const Rating = require("../models/Rating");
const Combo = require("../models/Combo");

const router = express.Router();



router.post("vendor/:vendorId/rate", authMiddleware, async(req, res) =>{
    const customer = req.user
    const vendorId = req.params.vendorId;
    const { ratingNumber, comment } = req.body

    const rating = new Rating({
        vendor: vendorId,
        customer: customer._id,
        rating : ratingNumber,
        comment: comment
    })
    rating.save()
    res.status(200).json({message: "Rating saved successfully"})
})

router.put("combo/:comboId/like", authMiddleware, async(req,res) =>{
    const comboId = req.params.comboId;
    const combo = await Combo.findByIdAndUpdate(comboId, {$set: {likes: likes + 1}}, {new: true})
    res.status(200).json({message: "liked successfully"}, combo)
})


module.exports = router;