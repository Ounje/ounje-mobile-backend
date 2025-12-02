// config/db.js

// Import all necessary Mongoose Models so they can be accessed globally
// NOTE: Adjust the paths below based on where your model files (e.g., Vendor.js, Driver.js) are located.

try {
    module.exports = {
        // Core User/Auth Models
        User: require('../models/User'), 
        
        // Business Models
        Order: require('../models/Order'),
        
        // Vendor and Logistics Models
        // The names used here (e.g., 'restaurants', 'drivers') must match how you access them (db.restaurants)
        restaurants: require('../models/Vendor'), // Assuming Vendor model handles restaurant data
        drivers: require('../models/Driver'),
        
        // You would add other models here:
        // Cuisines: require('../models/Cuisine'), 
    };

    console.log("Database models successfully compiled and exported.");

} catch (error) {
    console.error("CRITICAL ERROR: Failed to load Mongoose models in config/db.js.", error.message);
    // Throwing the error again will help debug if a model file itself is broken.
    throw error; 
}