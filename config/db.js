// config/db.js
const logger = require("../utils/logger");

// Import all necessary Mongoose Models so they can be accessed globally

try {
    module.exports = {
        // Core User/Auth Models
        User: require('../models/User'),

        // Business Models
        Order: require('../models/Order'),

        // Vendor and Logistics Models
        restaurants: require('../models/VendorProfile'), // VendorProfile handles restaurant data

        riders: require('../models/RiderProfile'),

    };

    logger.info("Database models successfully compiled and exported.");

} catch (error) {
    logger.error(`CRITICAL ERROR: Failed to load Mongoose models in config/db.js. ${error.message}`);
    throw error;
}