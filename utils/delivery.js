require('dotenv').config();
const { Client } = require("@googlemaps/google-maps-services-js");
const { AVAILABLE_ZONES } = require("./constants");

const googleClient = new Client({});

// ── OunjeFood Delivery Pricing Algorithm ─────────────────────────────────────
// Source: OunjeFood Delivery Pricing Algorithm document (CEO: Madu South)
//
// Short trips (0–1.5 km): Base Fee only, no distance fee
// Medium/Long trips (>1.5 km): (Base Fee + Distance Fee) × Surge Multiplier
// Per-Km Rate: ₦150 for all rider types
// Surge: 1.0 (normal) | 1.2 (moderate demand) | 1.3 hard cap (peak/bad weather)

const TIERS = [
    { max: 1.5,      base: 500,  start: 0    },   // Very short — base fee only
    { max: 3.5,      base: 700,  start: 1.5  },   // Short to medium
    { max: 6.0,      base: 750,  start: 3.5  },   // Medium
    { max: 10.0,     base: 900,  start: 6.0  },   // Long
    { max: 15.0,     base: 1200, start: 10.0 },   // Very long
    { max: Infinity, base: 1400, start: 15.0 },   // Dynamic long-distance (max ₦1900)
];

const PER_KM_RATE = 150;          // ₦150/km beyond tier start
const MAX_LONG_DISTANCE_FEE = 1900; // Cap for 15km+ tier
const SURGE_CAP = 1.3;

// ── Core fee calculation (works on a known distance in km) ──────────────────
function calculateOunjeFeeFromDistance(distanceKm, surge = 1.0) {
    const s = Math.min(surge, SURGE_CAP);
    const tier = TIERS.find(t => distanceKm <= t.max) || TIERS[TIERS.length - 1];

    // Short trip rule: 0–1.5 km → base fee only, no distance charge
    if (distanceKm <= 1.5) {
        return Math.ceil((tier.base * s) / 10) * 10;
    }

    const extraFee = (distanceKm - tier.start) * PER_KM_RATE;
    const raw = tier.base + extraFee;

    // Cap the 15km+ tier at ₦1900
    const capped = distanceKm > 15 ? Math.min(raw, MAX_LONG_DISTANCE_FEE) : raw;

    return Math.ceil((capped * s) / 10) * 10;
}

// ── Haversine distance (km) between two lat/lng points ───────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Coordinate-based fee estimate (no Google Maps API call) ─────────────────
// GeoJSON convention: coordinates = [longitude, latitude]
function calculateOunjeFeeFromCoords(vLng, vLat, cLng, cLat, surge = 1.0) {
    const distanceKm = haversineKm(vLat, vLng, cLat, cLng);
    const fee = calculateOunjeFeeFromDistance(distanceKm, surge);
    return { fee, distanceKm };
}

// ── Fee breakdown for API responses ─────────────────────────────────────────
function buildFeeBreakdown(distanceKm, surge = 1.0) {
    const s = Math.min(surge, SURGE_CAP);
    const tier = TIERS.find(t => distanceKm <= t.max) || TIERS[TIERS.length - 1];
    const isShortTrip = distanceKm <= 1.5;
    const distanceFee = isShortTrip ? 0 : (distanceKm - tier.start) * PER_KM_RATE;
    const raw = tier.base + distanceFee;
    const capped = distanceKm > 15 ? Math.min(raw, MAX_LONG_DISTANCE_FEE) : raw;
    const total = Math.ceil((capped * s) / 10) * 10;

    return {
        distanceKm: Math.round(distanceKm * 100) / 100,
        tier: `${tier.start}–${tier.max === Infinity ? "15+" : tier.max} km`,
        baseFee: tier.base,
        distanceFee: Math.round(distanceFee),
        surgeMultiplier: s,
        isShortTrip,
        total,
    };
}

// ── Google Maps-backed calculation (used at order creation) ─────────────────
async function calculateOunjeFee(vendorAddr, customerAddr, surge = 1.0) {
    console.log(`Delivery fee calc: ${vendorAddr} → ${customerAddr}`);
    try {
        const response = await googleClient.distancematrix({
            params: {
                origins: [vendorAddr],
                destinations: [customerAddr],
                key: process.env.GOOGLE_MAPS_API_KEY,
            },
        });

        if (
            !response.data?.rows?.[0]?.elements?.[0]
        ) {
            throw new Error("Google Maps Error: Invalid API response");
        }

        const element = response.data.rows[0].elements[0];
        if (element.status !== "OK") {
            throw new Error(`Google Maps Error: ${element.status}`);
        }

        const distanceKm = element.distance.value / 1000;
        return calculateOunjeFeeFromDistance(distanceKm, surge);
    } catch (error) {
        console.error("Pricing Error:", error.message);
        throw error;
    }
}

const identifyZone = (address) => {
    if (!address) return "Other";
    const lower = address.toLowerCase();
    const found = AVAILABLE_ZONES.find(zone => lower.includes(zone.toLowerCase()));
    return found || "Other";
};

const getCoordsFromAddress = async (address) => {
    try {
        const response = await googleClient.geocode({
            params: { address, key: process.env.GOOGLE_MAPS_API_KEY },
        });
        if (response.data.results.length > 0) {
            return response.data.results[0].geometry.location; // { lat, lng }
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
        return Math.ceil(element.duration.value / 60) + 10; // +10 min prep
    } catch (error) {
        console.error("ETA Error:", error.message);
        return null;
    }
}

module.exports = {
    calculateOunjeFee,
    calculateOunjeFeeFromDistance,
    calculateOunjeFeeFromCoords,
    buildFeeBreakdown,
    haversineKm,
    identifyZone,
    getCoordsFromAddress,
};
