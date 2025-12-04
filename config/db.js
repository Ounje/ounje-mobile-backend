// config/db.js

// Import all necessary Mongoose Models so they can be accessed globally

try {
    module.exports = {
        // Core User/Auth Models
        User: require('../models/User'), 
        
        // Business Models
        Order: require('../models/Order'),
        
        // Vendor and Logistics Models
        restaurants: require('../models/Vendor'), // Assuming Vendor model handles restaurant data
        
        // --- THIS IS THE CORRECTED LINE ---
        riders: require('../models/Rider'), 
        
    };

    console.log("Database models successfully compiled and exported.");

} catch (error) {
    console.error("CRITICAL ERROR: Failed to load Mongoose models in config/db.js.", error.message);
    throw error; 
}