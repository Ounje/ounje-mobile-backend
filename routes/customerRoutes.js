const express = require("express");
const { getCustomerProfile } = require("../controllers/customerController");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();


router.get("/profile", authMiddleware,  getCustomerProfile);

module.exports = router;
