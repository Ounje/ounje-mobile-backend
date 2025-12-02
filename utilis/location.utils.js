// location.utils.js (CORRECTED)

// Import the service object, not the wrapper function
const { geocodingService } = require('../services/mapbox.service'); 

/**
* Converts a street address into a [longitude, latitude] coordinate pair.
* @param {string} address The full delivery address string.
* @returns {object|null} {longitude, latitude} or null if failed.
*/
async function getCoordinatesFromAddress(address) {
 
  // FIX: Add validation check (address must be a non-empty string)
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
      console.error("Mapbox Geocoding Error: Invalid or empty address input.");
      return null;
  }
  
 try {
  // FIX: Call forwardGeocode on the imported service object, which returns the request object with .send()
  const response = await geocodingService.forwardGeocode({
   query: address,
   limit: 1, 
   // countries: ['NG', 'GH'], 
  }).send(); // The .send() is now correctly attached

  if (response.body.features && response.body.features.length) {
   // Mapbox returns coordinates as [longitude, latitude]
   const [longitude, latitude] = response.body.features[0].center; 
   return { longitude, latitude };
  }
  return null;

 } catch (error) {
  console.error('Mapbox Geocoding Error:', error.message);
  return null; // Don't crash the server, return null for failure
 }
}

module.exports = { getCoordinatesFromAddress };