// services/tracking.service.js

const { getDirections } = require('./mapbox.service');
const db = require('../config/db'); // Assume this handles your database interactions

/**
 * Calculates and updates the live ETA for a single assigned order.
 * @param {string} orderId The ID of the order being tracked.
 * @param {number[]} driverCoords The driver's current [longitude, latitude].
 */
async function updateLiveTracking(orderId, driverCoords) {
  // 1. Fetch current order and location data
  const order = await db.orders.get(orderId);
  const restaurant = await db.restaurants.get(order.restaurantId);

  // Determine the Waypoints based on the order status
  const waypoints = [];

  // Driver's current location is always the start point
  waypoints.push({ coordinates: driverCoords }); 

  // If the driver hasn't picked up the food yet
  if (order.status === 'Driver Assigned' || order.status === 'En Route to Restaurant') {
    // Next stop: Restaurant (Pickup)
    waypoints.push({ coordinates: [restaurant.longitude, restaurant.latitude] }); 

    // Final stop: Customer (Delivery)
    waypoints.push({ coordinates: [order.deliveryLongitude, order.deliveryLatitude] }); 
  } 
  // If the driver has picked up the food
  else if (order.status === 'En Route to Customer') {
    // Final stop: Customer (Delivery)
    waypoints.push({ coordinates: [order.deliveryLongitude, order.deliveryLatitude] });
  } else {
    // Order is complete, no tracking needed
    return; 
  }

  // 2. Call the Directions API
  try {
    const response = await getDirections({
      profile: 'driving-traffic', // CRITICAL: Uses real-time traffic
      waypoints: waypoints,
      geometries: 'geojson', // Request the route line geometry for the frontend map
    }).send();

    if (response.body.routes && response.body.routes.length) {
      const route = response.body.routes[0];
      const durationSeconds = route.duration;

      // 3. Update Order ETA in database
      const liveETAminutes = Math.ceil(durationSeconds / 60);

      await db.orders.update(orderId, {
        liveETA: liveETAminutes,
        // The geometry (route line) is typically sent to the frontend via WebSockets/API
        routeGeometry: route.geometry, 
      });

      // 4. Push update (WebSockets/API) - Discussed in Step 6
      // pushUpdateToCustomer(orderId, { liveETA: liveETAminutes, routeGeometry: route.geometry });

    }
  } catch (error) {
    console.error(`Error updating tracking for order ${orderId}:`, error.message);
  }
}

module.exports = { updateLiveTracking };