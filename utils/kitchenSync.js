const axios = require('axios');

// Centralized Kitchen URL from .env
const KITCHEN_BASE_URL = process.env.KITCHEN_API_URL || "http://localhost:5001/api/mobile-sync";

const syncHeaders = (secret) => ({
    headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': secret || process.env.SYNC_SECRET
    }
});

/**
 * Sends order data to the Ounje-Kitchen-Backend
 * Renamed to syncOrderToKitchen to match your Controller
 */
const syncOrderToKitchen = async (orderData) => {
    try {
        const response = await axios.post(`${KITCHEN_BASE_URL}/sync-order`, orderData, syncHeaders());
        console.log("✅ Sync: Order sent to Kitchen successfully");
        return response.data;
    } catch (error) {
        console.error("❌ Order Sync Failed:", error.response?.data || error.message);
    }
};

/**
 * Mirrors a user profile to the Kitchen
 */
const syncUserToKitchen = async (type, userData) => {
    try {
        const response = await axios.post(`${KITCHEN_BASE_URL}/sync-user`, { type, userData }, syncHeaders());
        console.log(`✅ Sync: ${type} mirrored to Kitchen successfully`);
        return response.data;
    } catch (error) {
        console.error("❌ User Sync Failed:", error.response?.data || error.message);
    }
};

// Make sure these names match exactly what you 'require' in your controllers
module.exports = { syncOrderToKitchen, syncUserToKitchen };