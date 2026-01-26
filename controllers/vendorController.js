const mongoose = require("mongoose");
const Vendor = require("../models/Vendor");
const Combo = require("../models/Combo");
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
		res
			.status(500)
			.json({ message: "Internal Server Error", error: err.message });
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
		const allVendors = await Vendor.find({ isAvailable: { $ne: false } }).limit(
			20,
		);

		res.status(200).json({
			status: "success",
			source: "default-fallback",
			results: allVendors.length,
			data: allVendors,
		});
	} catch (err) {
		console.error("Nearby Vendors Error:", err.message);
		res
			.status(500)
			.json({ message: "Error retrieving vendors", error: err.message });
	}
};

const completeVendorRegistration = async (req, res) => {
	try {
		let {
			storeName,
			storeType,
			isVerifiedBusiness,
			CACNumber,
			servicesOffered,
			needCACHelp,
			day,
			openingHour,
			closingHour,
			orderingTime,
			preparationTime,
			period,
		} = req.body;

		let timePeriod = [];
		if (req.body.timePeriod && Array.isArray(req.body.timePeriod)) {
			timePeriod = req.body.timePeriod;
		} else {
			let i = 0;
			while (req.body[`timePeriod[${i}][day]`]) {
				timePeriod.push({
					day: req.body[`timePeriod[${i}][day]`],
					openingHour: req.body[`timePeriod[${i}][openingHour]`],
					closingHour: req.body[`timePeriod[${i}][closingHour]`],
				});
				i++;
			}
			if (timePeriod.length === 0 && day && openingHour && closingHour) {
				timePeriod.push({ day, openingHour, closingHour });
			}
		}

		let preorderPeriods = [];
		if (req.body.preorderPeriods && Array.isArray(req.body.preorderPeriods)) {
			preorderPeriods = req.body.preorderPeriods;
		} else {
			let i = 0;
			while (req.body[`preorderPeriods[${i}][orderingTime]`]) {
				preorderPeriods.push({
					orderingTime: req.body[`preorderPeriods[${i}][orderingTime]`],
					preparationTime: req.body[`preorderPeriods[${i}][preparationTime]`],
					period: req.body[`preorderPeriods[${i}][period]`],
				});
				i++;
			}

			if (
				preorderPeriods.length === 0 &&
				orderingTime &&
				preparationTime &&
				period
			) {
				preorderPeriods.push({ orderingTime, preparationTime, period });
			}
		}

		const vendorId = req.user.id;

		const vendor = await Vendor.findById(vendorId);
		if (!vendor) {
			return res.status(404).json({
				success: false,
				message: "Vendor not found",
			});
		}

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

		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "NIN ID document is required",
			});
		}

		const ninIDUrl = req.file.path;

		let accountStatus = "active";
		let needsCACSupport = false;
		let warningMessage = null;

		if (!isBusinessVerified) {
			if (!needCACHelp) {
				return res.status(400).json({
					success: false,
					message:
						"Your business needs to be registered. Would you like us to help you with CAC registration?",
					needsCAC: true,
				});
			}

			if (needCACHelp === "yes") {
				needsCACSupport = true;
				accountStatus = "pending";
				warningMessage =
					"Your account is pending. Our support team will contact you regarding CAC registration assistance.";
			} else if (needCACHelp === "no" || needCACHelp === "No") {
				accountStatus = "pending";
				warningMessage =
					"Please do well to complete your CAC registration so that your business will be safe from legal fines.";
			}
		} else {
			if (!CACNumber) {
				return res.status(400).json({
					success: false,
					message: "CAC number is required for verified businesses",
				});
			}

			accountStatus = "active";
		}

		let storeDetailsData = {
			storeName,
			storeType,
			isVerifiedBusiness: isBusinessVerified,
			CACNumber: CACNumber || null,
			servicesOffered,
			ninID: ninIDUrl,
			status: accountStatus,
			needsCACSupport,
		};

		if (servicesOffered === "preOrderMeals") {
			if (!preorderPeriods || preorderPeriods.length === 0) {
				return res.status(400).json({
					success: false,
					message:
						"At least one preorder period (orderingTime, preparationTime, and period) is required for pre-order services",
				});
			}

			for (const pp of preorderPeriods) {
				if (!pp.orderingTime || !pp.preparationTime || !pp.period) {
					return res.status(400).json({
						success: false,
						message:
							"Each preorder period must include orderingTime, preparationTime, and period",
					});
				}

				if (!["breakfast", "lunch", "dinner"].includes(pp.period)) {
					return res.status(400).json({
						success: false,
						message: `Invalid period: ${pp.period}. Must be one of 'breakfast', 'lunch', or 'dinner'`,
					});
				}
			}

			storeDetailsData.preorderPeriods = preorderPeriods;
		} else if (
			servicesOffered === "InstantMeals" ||
			servicesOffered === "hybridMeals"
		) {
			if (!timePeriod || timePeriod.length === 0) {
				return res.status(400).json({
					success: false,
					message:
						"At least one time period is required for instant/hybrid meal services",
				});
			}

			const validDays = [
				"sunday",
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
			];

			for (const tp of timePeriod) {
				if (!tp.day || !tp.openingHour || !tp.closingHour) {
					return res.status(400).json({
						success: false,
						message:
							"Each time period must include day, openingHour, and closingHour",
					});
				}

				if (!validDays.includes(tp.day.toLowerCase())) {
					return res.status(400).json({
						success: false,
						message: `Invalid day: ${tp.day}. Must be one of: ${validDays.join(", ")}`,
					});
				}
			}

			storeDetailsData.timePeriod = timePeriod.map((tp) => ({
				day: tp.day.toLowerCase(),
				openingHour: tp.openingHour,
				closingHour: tp.closingHour,
			}));
		}
		vendor.storeDetails = [storeDetailsData];

		if (vendor.balance == null) {
			vendor.balance = 0;
		}

		await vendor.save();

		const responseData = {
			vendorId: vendor._id,
			storeName,
			storeType,
			servicesOffered,
			status: accountStatus,
		};
		if (servicesOffered === "preOrderMeals") {
			responseData.preorderPeriods = storeDetailsData.preorderPeriods;
		} else if (storeDetailsData.timePeriod) {
			responseData.timePeriod = storeDetailsData.timePeriod;
		}

		if (accountStatus === "pending") {
			return res.status(200).json({
				success: true,
				message: `Vendor registration completed successfully. ${warningMessage}`,
				accountStatus: "pending",
				needsCACSupport,
				data: responseData,
			});
		}

		res.status(200).json({
			success: true,
			message: "Vendor registration completed successfully",
			accountStatus: "active",
			data: responseData,
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
