const { geocoder, directions } = require("../config/mapbox");
const Vendor = require("../models/Vendor");

const addressToCoords= async(address) => {
  const response = await geocoder.forwardGeocode({
    query: address,
    limit: 1
  }).send();

  if (!response.body.features.length) return null;
  if (
    !response ||
    !response.body ||
    !response.body.features ||
    !response.body.features.length
    ){
    return null;
  }


  return {
    longitude: response.body.features[0].geometry.coordinates[0],
    latitude: response.body.features[0].geometry.coordinates[1],
    fullAddress: response.body.features[0].place_name
  };
}


const coordsToAddress = async(lng, lat) => {
  const response = await geocoder.reverseGeocode({
    query: [lng, lat],
    limit: 1
  }).send();

  return response.body.features[0].place_name;
}

const getRouteInfo = async(start, end) => {
  const response = await directions.getDirections({
    profile: "driving",
    geometries: "geojson",
    waypoints: [
      { coordinates: start },
      { coordinates: end }
    ]
  }).send();

  const route = response.body.routes[0];

  return {
    distance_km: route.distance / 1000,
    duration_min: route.duration / 60,
    raw: route
  };
}

const vendorsNearYou = async (location, radiusKm) => {
  const [lng, lat] = location;

  return Vendor.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [lng, lat] },
        distanceField: "distance",
        maxDistance: radiusKm * 1000,
        spherical: true
      }
    }
  ]);
};
module.exports = {
  addressToCoords,
  coordsToAddress,
    getRouteInfo,
    vendorsNearYou,
};
