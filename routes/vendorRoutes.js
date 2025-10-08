const express = require('express');
const { getPopularVendors, getVendor, userGetVendor } = require('../controllers/vendorController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();


router.get('/popular', getPopularVendors)


router.get("/profile", authMiddleware , getVendor);

router.get("/vendor/:id", userGetVendor);

module.exports = router;