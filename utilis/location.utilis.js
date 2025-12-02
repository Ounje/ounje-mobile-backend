// utils/location.utils.js

const { geocodeAddress } = require('../services/mapbox.service');

/**
 * Converts a street address into a [longitude, latitude] coordinate pair.
 * @param {string} address The full delivery address string.
 * @returns {object|null} {longitude, latitude} or null if failed.
 */
async function getCoordinatesFromAddress(address) {
  try {
    const response = await geocodeAddress({
      query: address,
      limit: 1, 
      // Set to your service area for higher accuracy
      // countries: ['NG', 'GH'], 
    }).send();

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