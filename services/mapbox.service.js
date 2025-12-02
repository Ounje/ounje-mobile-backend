// mapbox.service.js (CORRECTED)

const mbxGeocoding = require('@mapbox/mapbox-sdk/services/geocoding');
const mbxDirections = require('@mapbox/mapbox-sdk/services/directions');
const mbxMatrix = require('@mapbox/mapbox-sdk/services/matrix');

const mapboxToken = process.env.MAPBOX_SECRET_TOKEN;

// Initialize each service separately
const geocodingService = mbxGeocoding({ accessToken: mapboxToken });
const directionsService = mbxDirections({ accessToken: mapboxToken });
const matrixService = mbxMatrix({ accessToken: mapboxToken });

module.exports = {
  // EXPORT THE INITIALIZED SERVICES DIRECTLY
  geocodingService, 
  directionsService,
  matrixService
};