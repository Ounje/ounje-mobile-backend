// controllers/riderController.js (Formerly driver.controller.js)

const { updateLiveTracking } = require('../services/tracking.service');
const db = require('../config/db'); 

async function handleLocationUpdate(req, res) {
    // Renamed from driverId
    const { riderId, longitude, latitude } = req.body; 

    try {

        // For testing, assume rider 'R1' is assigned to order '123'
        const activeOrder = { id: '123', status: 'out_for_delivery' }; // Use a real status
        
        if (activeOrder) {
            // --- DIRECTIONS API (Real-Time Tracking) ---
            const riderCoords = [longitude, latitude];
            await updateLiveTracking(activeOrder.id, riderCoords); 
        }

        res.status(200).send({ status: 'Location updated and tracking processed.' });
    } catch (error) {
        console.error('Location update failed:', error.message);
        res.status(500).send({ message: 'Failed to update location.', error: error.message });
    }
}

module.exports = { handleLocationUpdate };