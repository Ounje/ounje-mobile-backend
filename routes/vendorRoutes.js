const express = require('express');
const { getPopularVendors, getVendor } = require('../controllers/vendorController');

const router = express.Router();


router.get('/popular', getPopularVendors)


router.get("/profile/:id", getVendor);

module.exports = router;