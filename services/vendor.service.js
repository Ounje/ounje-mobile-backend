const Vendor = require("../models/Vendor");
const Customer = require("../models/Customer");

class VendorService {
    /**
     * Get nearby vendors based on location
     * @param {Object} params - The parameters for the query
     * @param {string} [params.lat] - Latitude
     * @param {string} [params.lng] - Longitude
     * @param {string} [params.userId] - User ID (optional, for fallback location)
     * @returns {Promise<Object>} The result object containing vendors and metadata
     */
    async getNearbyVendors({ lat, lng, userId }) {
        try {
            // STEP 1: If GPS is missing, try to get location from Customer Profile
            if ((!lat || !lng) && userId) {
                const customer = await Customer.findById(userId);
                if (customer && customer.location && customer.location.coordinates) {
                    lng = customer.location.coordinates[0];
                    lat = customer.location.coordinates[1];
                    // console.log("Using saved profile location for user:", userId);
                }
            }

            // STEP 2: If we have coordinates (from GPS or Profile), search by distance
            if (lat && lng) {
                const vendors = await Vendor.find({
                    isAvailable: { $ne: false }, // Only show vendors that are open
                    location: {
                        $near: {
                            $geometry: {
                                type: "Point",
                                coordinates: [parseFloat(lng), parseFloat(lat)],
                            },
                            $maxDistance: 10000, // 10km radius
                        },
                    },
                });

                return {
                    status: "success",
                    source: "location-based",
                    results: vendors.length,
                    data: vendors,
                };
            }

            // STEP 3: FINAL FALLBACK - If no location found at all, show all available vendors
            // console.log("No location available. Returning default vendor list.");
            const allVendors = await Vendor.find({ isAvailable: { $ne: false } }).limit(20);

            return {
                status: "success",
                source: "default-fallback",
                results: allVendors.length,
                data: allVendors,
            };
        } catch (error) {
            throw error; // Re-throw to be handled by controller
        }
    }
}

module.exports = new VendorService();
