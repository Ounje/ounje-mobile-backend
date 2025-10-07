const express = require('express');
const { getPopularVendors, getVendor } = require('../controllers/vendorController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();


router.get('/popular', getPopularVendors)


router.get("/profile", authMiddleware , getVendor);

module.exports = router;