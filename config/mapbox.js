const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");
const mbxDirections = require("@mapbox/mapbox-sdk/services/directions");

const geocoder = mbxGeocoding({ accessToken: process.env.MAPBOX_ACCESS_TOKEN });
const directions = mbxDirections({ accessToken: process.env.MAPBOX_ACCESS_TOKEN });

module.exports = { geocoder, directions };
