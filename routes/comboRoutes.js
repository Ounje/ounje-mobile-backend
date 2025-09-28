const express = require("express");
const { getPopularCombos } = require("../controllers/comboContoller");
const router = express.Router();

router.get("/popular", getPopularCombos);




module.exports = router;