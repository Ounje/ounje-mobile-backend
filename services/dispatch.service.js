// services/dispatch.service.js

const { matrixService } = require('./mapbox.service');
// FIX 1: This now imports the object containing the Mongoose models (Restaurant, Driver, Order)
const db = require('../config/db'); 

async function dispatchDriver(order) {
 // 1. Fetch all necessary coordinates
  
  // FIX 2: Mongoose uses findById() to fetch a single document by ID (e.g., the Restaurant)
  // We use .lean() for performance since we only need the data, not Mongoose methods.
 const restaurant = await db.restaurants.findById(order.restaurantId).lean(); 
 
  // FIX 3: Mongoose uses find() to query for available drivers
 const availableDrivers = await db.drivers.find({ isAvailable: true, isActive: true }).lean(); 

 if (!restaurant) {
     console.error(`Restaurant with ID ${order.restaurantId} not found. Cannot dispatch.`);
     return null;
  }
  
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

  // Mapbox Matrix API call (already fixed in previous step)
 const response = await matrixService.getMatrix({
  profile: 'driving-traffic', // Ensures real-time data is used
  coordinates: matrixCoordinates,
  sources: driverIndices,   // Time FROM drivers...
  destinations: [restaurantIndex] // ...TO the restaurant.
 }).send();

 const durations = response.body.durations; 

 // 4. Find the best driver (shortest time to pickup)
 let bestDriver = null;
 let shortestPickupTime = Infinity;

 for (let i = 0; i < availableDrivers.length; i++) {
  const timeToPickup = durations[i][0]; 

  if (timeToPickup < shortestPickupTime) {
   shortestPickupTime = timeToPickup;
   bestDriver = availableDrivers[i];
  }
 }

 // 5. Assign and update status
 if (bestDriver) {
    // FIX 4: Mongoose update should use findByIdAndUpdate on the Order Model
  await db.Order.findByIdAndUpdate(order.id, { 
        driverId: bestDriver._id, 
        status: 'Driver Assigned' 
    });
  console.log(`Order ${order.id} assigned to driver ${bestDriver._id}. Pickup ETA: ${Math.ceil(shortestPickupTime / 60)} minutes.`);
 }

 return bestDriver;
}

module.exports = { dispatchDriver };