// services/dispatch.service.js

const { getTravelMatrix } = require('./mapbox.service');
const db = require('../config/db'); // Assume you fetch drivers and restaurant data here

async function dispatchDriver(order) {
  // 1. Fetch all necessary coordinates
  const restaurant = await db.restaurants.get(order.restaurantId);
  const availableDrivers = await db.drivers.findAvailable();

  if (availableDrivers.length === 0) {
    console.warn(`No drivers available for order ${order.id}.`);
    return null;
  }

  // All Mapbox coordinates must be [longitude, latitude]
  const restaurantCoords = [restaurant.longitude, restaurant.latitude];

  // 2. Build the Matrix coordinates array
  // Array structure: [D1, D2, D3, ..., Restaurant]
  const matrixCoordinates = [
    ...availableDrivers.map(d => [d.longitude, d.latitude]),
    restaurantCoords 
  ];

  // 3. Define Sources (Drivers) and Destinations (Restaurant)
  const driverIndices = availableDrivers.map((_, index) => index);
  const restaurantIndex = availableDrivers.length; // The last item in the array

  const response = await getTravelMatrix({
    profile: 'driving-traffic', // Ensures real-time data is used
    coordinates: matrixCoordinates,
    sources: driverIndices,      // Time FROM drivers...
    destinations: [restaurantIndex] // ...TO the restaurant.
  }).send();

  const durations = response.body.durations; // durations[i][0] is time from Driver i to Restaurant

  // 4. Find the best driver (shortest time to pickup)
  let bestDriver = null;
  let shortestPickupTime = Infinity;

  for (let i = 0; i < availableDrivers.length; i++) {
    const timeToPickup = durations[i][0]; // Time in seconds

    if (timeToPickup < shortestPickupTime) {
      shortestPickupTime = timeToPickup;
      bestDriver = availableDrivers[i];
    }
  }

  // 5. Assign and update status
  if (bestDriver) {
    await db.orders.update(order.id, { driverId: bestDriver.id, status: 'Driver Assigned' });
    console.log(`Order ${order.id} assigned to driver ${bestDriver.id}. Pickup ETA: ${Math.ceil(shortestPickupTime / 60)} minutes.`);
  }

  return bestDriver;
}

module.exports = { dispatchDriver };