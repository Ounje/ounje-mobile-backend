require('dotenv').config();
const { Client } = require("@googlemaps/google-maps-services-js");
const axios = require("axios");

const googleClient = new Client({});

// Tiers from the OunjeFood Algorithm [cite: 12]
const TIERS = [
    { max: 1.5, base: 450, start: 0 },
    { max: 3.5, base: 600, start: 1.5 },
    { max: 6.0, base: 750, start: 3.5 },
    { max: 10.0, base: 900, start: 6.0 },
    { max: 15.0, base: 1200, start: 10.0 },
    { max: Infinity, base: 1500, start: 15.0 } // Dynamic long-distance range
];

const PER_KM_RATE = 120; // [cite: 18]
const MIN_DISTANCE_FEE = 200; // [cite: 27]

// utilis/delivery.js

const identifyZone = (address) => {
    const zones = ["Ikeja", "Yaba", "Surulere", "Lekki", "Victoria Island", "Ajah"];

    // Convert address to lowercase to make searching easier
    const lowercaseAddress = address.toLowerCase();

    // Find which zone name exists inside the address string
    const foundZone = zones.find(zone => lowercaseAddress.includes(zone.toLowerCase()));

    return foundZone || "Other"; // Default to 'Other' if no match is found
};

async function calculateOunjeFee(vendorAddr, customerAddr, surge = 1.0) {
    console.log(`Attempting calculation: From ${vendorAddr} To ${customerAddr}`);
    try {
        const response = await googleClient.distancematrix({
            params: {
                origins: [vendorAddr],
                destinations: [customerAddr],
                key: process.env.GOOGLE_MAPS_API_KEY,
            },
        });

        if (
            !response.data ||
            !response.data.rows ||
            !response.data.rows[0] ||
            !response.data.rows[0].elements ||
            !response.data.rows[0].elements[0]
        ) {
            console.error("Pricing Error: Invalid response structure from Google Maps");
            throw new Error("Google Maps Error: Invalid API response");
        }

        const element = response.data.rows[0].elements[0];

        if (element.status !== "OK") {
            const errorMessage = `Google Maps Error: ${element.status}`;
            console.error(`Pricing Error: ${errorMessage}`);
            throw new Error(errorMessage);
        }

        // Get distance in KM [cite: 17, 20]
        const distanceKm = element.distance.value / 1000;

        // 1. Find the correct Tier [cite: 11, 12]
        const tier = TIERS.find(t => distanceKm <= t.max) || TIERS[TIERS.length - 1];

        // 2. Calculate Extra Distance Fee [cite: 17]
        let extraDistanceFee = (distanceKm - tier.start) * PER_KM_RATE;

        // 3. Apply Minimum Distance Fee for very short trips [cite: 25, 27]
        if (distanceKm < 0.5 && extraDistanceFee < MIN_DISTANCE_FEE) {
            extraDistanceFee = MIN_DISTANCE_FEE;
        }

        // 4. Calculate Total and apply Surge [cite: 36, 45]
        const totalFee = (tier.base + extraDistanceFee) * surge;

        // Round to nearest 10 as per Example B [cite: 24, 56]
        return Math.ceil(totalFee / 10) * 10;

    } catch (error) {
        console.error("Pricing Error:", error.message);
        throw error; // Re-throw the error to be handled by the caller
    }
}

const getCoordsFromAddress = async (address) => {
    try {
        const response = await googleClient.geocode({
            params: {
                address: address,
                key: process.env.GOOGLE_MAPS_API_KEY,
            },
        });

        if (response.data.results.length > 0) {
            return response.data.results[0].geometry.location; // Returns { lat, lng }
        }
        return null;
    } catch (error) {
        console.error("Geocoding Error:", error);
        return null;
    }
};

async function getEstimatedDeliveryTime(vendorAddr, customerAddr) {
    try {
        const response = await googleClient.distancematrix({
            params: {
                origins: [vendorAddr],
                destinations: [customerAddr],
                key: process.env.GOOGLE_MAPS_API_KEY,
            },
        });

        const element = response.data.rows[0].elements[0];
        if (element.status !== "OK") return null;

        const durationMinutes = Math.ceil(element.duration.value / 60);
        // Add 10 mins preparation time
        return durationMinutes + 10;
    } catch (error) {
        console.error("ETA Error:", error.message);
        return null;
    }
}

// Updated exports to include this
module.exports = { calculateOunjeFee, identifyZone, getCoordsFromAddress };