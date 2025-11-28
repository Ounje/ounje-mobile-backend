const mbxGeocoding = require('@mapbox/mapbox-sdk/services/geocoding');
const mbxDirections = require('@mapbox/mapbox-sdk/services/directions');
const mbxMatrix = require('@mapbox/mapbox-sdk/services/matrix');

const mapboxToken = process.env.MAPBOX_SECRET_TOKEN;

// Initialize each service separately
const geocodingService = mbxGeocoding({ accessToken: mapboxToken });
const directionsService = mbxDirections({ accessToken: mapboxToken });
const matrixService = mbxMatrix({ accessToken: mapboxToken });

module.exports = {
  geocodeAddress: async (address) => {
    return geocodingService.forwardGeocode({
      query: address,
      limit: 1,
    }).send();
  },

  reverseGeocode: async (lng, lat) => {
    return geocodingService.reverseGeocode({
      query: [lng, lat],
      limit: 1,
    }).send();
  },

  getTravelMatrix: async (coords) => {
    return matrixService.getMatrix({
      points: coords, // array of [lng, lat]
      profile: 'driving',
    }).send();
  },

  getDirections: async (start, end) => {
    return directionsService.getDirections({
      profile: 'driving',
      geometries: 'geojson',
      waypoints: [
        { coordinates: start }, // [lng, lat]
        { coordinates: end }    // [lng, lat]
      ]
    }).send();
  }
};
