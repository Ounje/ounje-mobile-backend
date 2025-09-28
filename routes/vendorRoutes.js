const express = require('express');
const { getPopularVendors } = require('../controllers/vendorController');

const router = express.Router();


router.get('/popular', getPopularVendors)


module.exports = router;