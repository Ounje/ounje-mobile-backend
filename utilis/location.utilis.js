// utilis/location.utilis.js

// FIX: Import the service object, not a wrapper function
const { geocodingService } = require('../services/mapbox.service'); 

/**
* Converts a street address into a [longitude, latitude] coordinate pair.
* @param {string} address The full delivery address string.
* @returns {object|null} {longitude, latitude} or null if failed.
*/
async function getCoordinatesFromAddress(address) {
 
  // Validation to prevent "query must be a string" error
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
      console.error("Mapbox Geocoding Error: Invalid or empty address input.");
      return null;
  }
  
 try {
  // FIX: Call forwardGeocode on the imported service object
  const response = await geocodingService.forwardGeocode({
   query: address,
   limit: 1, 
   // Add optional parameters here, e.g., countries: ['NG']
  }).send(); 

  if (response.body.features && response.body.features.length) {
   // Mapbox returns coordinates as [longitude, latitude]
   const [longitude, latitude] = response.body.features[0].center; 
   return { longitude, latitude };
  }
  return null;

 } catch (error) {
  console.error('Mapbox Geocoding Error:', error.message);
  return null; // Return null for failure
 }
}

module.exports = { getCoordinatesFromAddress };