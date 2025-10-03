const express = require('express');
const { getPopularVendors, getVendor } = require('../controllers/vendorController');

const router = express.Router();


router.get('/popular', getPopularVendors)


router.get("/:id", getVendor);

module.exports = router;