// routes/riderRoutes.js (Corrected)

const express = require("express");
const router = express.Router(); // FIX 1: Must initialize the router
const { updateLiveTracking } = require('../services/tracking.service');
const db = require('../config/db'); // FIX 2: Assuming 'db' helper is accessible/imported here

// FIX 3: Endpoint corrected to '/location' since the server.js prefix is '/api/riders'
// FIX 4: Changed internal logic references from 'driverId' to 'riderId'
router.post('/location', async (req, res) => {
    const { riderId, longitude, latitude } = req.body;
    
    try {
        // 1. Update the rider's current position in your DB (Ensure this function exists)
        await db.riders.updateLocation(riderId, longitude, latitude); 

        // 2. Get the active order assigned to this rider (Ensure this function exists)
        // FIX 5: Use riderId to find the order
        const activeOrder = await db.orders.findByRider(riderId); 

        if (activeOrder) {
            // 3. Trigger the Directions API calculation
            await updateLiveTracking(activeOrder.id, [longitude, latitude]); 
        }
        
        res.status(200).send({ status: 'Location updated and tracking processed.' });
    } catch (error) {
        console.error("Rider location update failed:", error.message);
        res.status(500).send({ message: "Failed to update location.", error: error.message });
    }
});

module.exports = router;