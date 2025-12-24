const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");


router.post("/create-platform-account", adminController.createPlatformAccount);

router.post("/login", adminController.adminLogin);

module.exports = router;