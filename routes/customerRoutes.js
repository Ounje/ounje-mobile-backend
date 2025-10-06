const express = require("express");
const { getCustomerProfile } = require("../controllers/customerController");

const router = express.Router();


router.get("/profile/:id", getCustomerProfile);

module.exports = router;
