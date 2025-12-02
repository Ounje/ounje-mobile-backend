// services/tracking.service.js

// FIX: Import the directionsService object
const { directionsService } = require('./mapbox.service'); 
const db = require('../config/db'); // Assume you fetch and update order data here

/**
 * Calculates the real-time ETA between two points using Mapbox Directions.
 * Used for live tracking the rider's progress.
 * @param {object} start - {longitude, latitude} of the current position.
 * @param {object} end - {longitude, latitude} of the destination.
 * @returns {number|null} ETA in seconds, or null on failure.
 */
async function getLiveETA(start, end) {
    // Basic validation
    if (!start || !end || !start.longitude || !end.longitude) {
        console.error("Invalid start or end coordinates provided for ETA calculation.");
        return null;
    }

    // Mapbox requires coordinates as [longitude, latitude] arrays
    const startCoords = [start.longitude, start.latitude];
    const endCoords = [end.longitude, end.latitude];

    try {
        // FIX: Call getDirections on the imported service object
        const response = await directionsService.getDirections({
            profile: 'driving-traffic', // Critical for accurate, real-time ETA
            waypoints: [
                { coordinates: startCoords },
                { coordinates: endCoords }
            ]
        }).send();

        // The duration is the time in seconds
        if (response.body.routes && response.body.routes.length > 0) {
            return response.body.routes[0].duration; 
        }

        return null;

    } catch (error) {
        console.error("Mapbox Directions API Error during ETA calculation:", error.message);
        return null;
    }
}

// You would use this function inside an Order or Rider controller
// to update the order status with the latest ETA.

async function updateOrderTracking(orderId, riderLocation) {
    const order = await db.orders.get(orderId);
    
    // Determine the next target (restaurant or customer)
    const target = (order.status === 'Picked Up') ? order.deliveryAddress : order.restaurantAddress;

    const etaSeconds = await getLiveETA(riderLocation, target);

    if (etaSeconds !== null) {
        // Update the order in the database with the ETA in minutes
        await db.orders.update(orderId, { 
            liveETA: Math.ceil(etaSeconds / 60)
        });
    }
}


module.exports = { getLiveETA /*, updateOrderTracking */ };