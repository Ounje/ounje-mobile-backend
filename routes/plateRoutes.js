const express = require("express");
const { buildPlate } = require("../controllers/plateContoller");
const router = express.Router();

router.post("/build-plate",buildPlate)




module.exports = router;