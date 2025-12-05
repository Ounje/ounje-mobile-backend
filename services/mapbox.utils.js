const axios = require('axios');

// IMPORTANT: Replace with your actual environment variable names
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN; 
const MAPBOX_GEOCODING_ENDPOINT = 'https://api.mapbox.com/geocoding/v5/mapbox.places/';

/**
 * Converts a human-readable address into geographical coordinates (lat/lon).
 * * @param {string} address - The address string provided by the customer.
 * @returns {object} { longitude: number, latitude: number } or null if not found.
 */
async function geocodeAddress(address) {
    if (!address || !MAPBOX_ACCESS_TOKEN) {
        console.error("Geocode error: Address or Mapbox token is missing.");
        return null;
    }

    // Mapbox URL structure: /:text.json
    const url = `${MAPBOX_GEOCODING_ENDPOINT}${encodeURIComponent(address)}.json`;
    
    try {
        const response = await axios.get(url, {
            params: {
                access_token: MAPBOX_ACCESS_TOKEN,
                // Restrict search to specific country (e.g., Nigeria, if applicable)
                // country: 'NG', 
                limit: 1 
            }
        });

        const features = response.data.features;
        if (features && features.length > 0) {
            // Mapbox coordinates are [longitude, latitude]
            const [longitude, latitude] = features[0].center;
            
            console.log(`Geocoding Success: ${address} -> [${longitude}, ${latitude}]`);
            return { longitude, latitude };

        } else {
            console.warn(`Geocoding failed to find coordinates for address: ${address}`);
            return null;
        }

    } catch (error) {
        console.error("Error calling Mapbox Geocoding API:", error.message);
        // Implement exponential backoff here if this was a critical API call that needs retrying
        return null;
    }
}

module.exports = {
    geocodeAddress
    // You can add other Mapbox utilities here later
};