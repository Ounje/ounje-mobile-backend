const Vendor = require("../models/Vendor");
const Dish = require("../models/Dish");
const payoutService = require("../services/payout.service");
const Customer = require("../models/Customer");
const FoodItem = require("../models/FoodItem"); 

// Get popular vendors
const getPopularVendors = async (req, res) => {
	try {
		const vendors = await Vendor.find().sort({ totalOrders: -1 });
		res.json(vendors);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

//Vendor side
//This is for getting the vendor's own details along with their menu
//you can only access this route if you're logged in as a vendor
const getVendor = async (req, res) => {
	try {
		const vendorId = req.user.id;
		const vendor = await Vendor.findById(vendorId).populate("menu");
		if (!vendor) return res.status(404).json({ message: "Vendor not found" });
		res.json(vendor);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

//Customer side
//with this you'll get the vendor details along with their menu and options
const userGetVendor = async (req, res) => {
    try {
        const vendorId = req.params.id;
        
        // Validate if the ID is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(vendorId)) {
            return res.status(400).json({ message: "Invalid Vendor ID format" });
        }

        const vendor = await Vendor.findById(vendorId)
            .populate("menu")
            .populate("foodItems");

        if (!vendor) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        // Always return a proper JSON object
        res.status(200).json(vendor);
    } catch (err) {
        console.error("USER_GET_VENDOR_ERROR:", err);
        // This ensures the frontend gets JSON error, not HTML
        res.status(500).json({ message: "Internal Server Error", error: err.message });
    }
};

const updateBankDetails = async (req, res) => {
	try {
		const vendorId = req.user.id;
		const { accountNumber, bankCode, accountName } = req.body;

		if (!accountNumber || !bankCode || !accountName) {
			return res
				.status(400)
				.json({ error: "accountNumber, bankCode, accountName required" });
		}

		const vendor = await Vendor.findByIdAndUpdate(
			vendorId,
			{ bankDetails: { accountNumber, bankCode, accountName } },
			{ new: true },
		);

		// Trigger retry of pending payouts
		const retryResults = await payoutService.processPendingPayoutsForUser(
			vendor._id,
			"VENDOR",
		);

		res.json({ vendor, retryResults });
	} catch (err) {
		console.error("Update bank details failed:", err.message);
		res.status(500).json({ error: err.message });
	}
};

// NEW: Get Nearby Vendors (Fixed User -> Vendor)
const getNearbyVendors = async (req, res) => {
    try {
        let { lat, lng } = req.query;
        let userId = req.user ? req.user.id : null;

        // STEP 1: If GPS is missing, try to get location from Customer Profile
        if ((!lat || !lng) && userId) {
            const customer = await Customer.findById(userId);
            if (customer && customer.location && customer.location.coordinates) {
                lng = customer.location.coordinates[0];
                lat = customer.location.coordinates[1];
                console.log("Using saved profile location for user:", userId);
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
                        $maxDistance: 10000, // Increased to 10km for better coverage
                    },
                },
            });

            return res.status(200).json({
                status: "success",
                source: "location-based",
                results: vendors.length,
                data: vendors,
            });
        }

        // STEP 3: FINAL FALLBACK - If no location found at all, show all available vendors
        console.log("No location available. Returning default vendor list.");
        const allVendors = await Vendor.find({ isAvailable: { $ne: false } }).limit(20);
        
        res.status(200).json({
            status: "success",
            source: "default-fallback",
            results: allVendors.length,
            data: allVendors,
        });

    } catch (err) {
        console.error("Nearby Vendors Error:", err.message);
        res.status(500).json({ message: "Error retrieving vendors", error: err.message });
    }
};

const completeVendorRegistration = async (req, res) => {
	try {
		const {
			storeName,
			storeType,
			isVerifiedBusiness,
			CACNumber,
			servicesOffered,
			needCACHelp,
		} = req.body;

		const vendorId = req.user.id;

		const vendor = await Vendor.findById(vendorId);
		if (!vendor) {
			return res.status(404).json({
				success: false,
				message: "Vendor not found",
			});
		}

		// Prevent multiple registrations
		if (vendor.storeDetails && vendor.storeDetails.length > 0) {
			return res.status(400).json({
				success: false,
				message: "Vendor profile already completed",
			});
		}

		if (!storeName || !storeType || !servicesOffered) {
			return res.status(400).json({
				success: false,
				message: "Store name, store type and services offered are required",
			});
		}

		if (!["physicalStore", "onlineStore"].includes(storeType)) {
			return res.status(400).json({
				success: false,
				message: "Invalid store type. Must be 'physicalStore' or 'onlineStore'",
			});
		}

		// Validate services
		if (
			!["InstantMeals", "preOrderMeals", "hybridMeals"].includes(
				servicesOffered,
			)
		) {
			return res.status(400).json({
				success: false,
				message:
					"Invalid services offered. Must be 'InstantMeals', 'preOrderMeals', or 'hybridMeals'",
			});
		}

		const isBusinessVerified =
			isVerifiedBusiness === true || isVerifiedBusiness === "true";

		// CAC logic
		let needsCACSupport = false;

		if (!isBusinessVerified) {
			if (!needCACHelp) {
				return res.status(400).json({
					success: false,
					message:
						"Your business needs to be registered. Would you like us to help you with CAC registration?",
					needsCAC: true,
				});
			}

			if (needCACHelp === "no") {
				return res.status(400).json({
					success: false,
					message:
						"A business is required to have a valid CAC number to complete vendor registration.",
				});
			}

			if (needCACHelp === "yes") {
				needsCACSupport = true;
			}
		} else {
			if (!CACNumber) {
				return res.status(400).json({
					success: false,
					message: "CAC number is required for verified businesses",
				});
			}
		}

		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "NIN ID document is required",
			});
		}

		const ninIDUrl = req.file.path;

		// Save store details
		vendor.storeDetails = [
			{
				storeName,
				storeType,
				isVerifiedBusiness: isBusinessVerified,
				CACNumber: CACNumber || null,
				servicesOffered,
				ninID: ninIDUrl,
				status: "pending",
				needsCACSupport,
			},
		];

		if (vendor.balance == null) {
			vendor.balance = 0;
		}

		await vendor.save();

		// Response
		if (needsCACSupport) {
			return res.status(200).json({
				success: true,
				message:
					"Store details saved successfully. Our support team will contact you shortly regarding CAC registration assistance.",
				requiresSupport: true,
				data: {
					vendorId: vendor._id,
					storeName,
					status: "active",
				},
			});
		}

		res.status(200).json({
			success: true,
			message: "Vendor registration completed successfully",
			data: vendor,
		});
	} catch (error) {
		console.error("Error completing vendor registration:", error);
		res.status(500).json({
			success: false,
			message: "An error occurred while completing vendor registration",
			error: error.message,
		});
	}
};

module.exports = {
	completeVendorRegistration,
	getPopularVendors,
	getVendor,
	userGetVendor,
	updateBankDetails,
	getNearbyVendors,
};
