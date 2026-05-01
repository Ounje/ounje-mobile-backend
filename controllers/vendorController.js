const vendorService = require("../services/vendor.service");
const mongoose = require("mongoose"); // needed only for ObjectId validation in userGetVendor (or move validation to service)
const { VendorProfile } = require("../models");
const { paginate } = require("../utils/paginate");
const logger = require("../utils/logger");
const ledgerService = require("../services/ledger.service");

const toNaira = (kobo) => (kobo ?? 0) / 100;

// GET /api/vendors/all — all active vendors for "See All" listing
// Optional query params: lat, lng — when provided, returns vendors with distanceMeters
const getAllVendors = async (req, res) => {
	try {
		const { lat, lng } = req.query;
		const baseFilter = { isActive: true, storeDetails: { $exists: true, $not: { $size: 0 } } };

		if (lat && lng) {
			const coordinates = [parseFloat(lng), parseFloat(lat)];
			const vendors = await VendorProfile.aggregate([
				{
					$geoNear: {
						near: { type: "Point", coordinates },
						distanceField: "distanceMeters",
						maxDistance: 5000,
						query: baseFilter,
						spherical: true,
					},
				},
				{
					$project: {
						name: 1, bannerUrl: 1, logoUrl: 1, profileImage: 1,
						location: 1, storeDetails: 1, averageRating: 1,
						ratingCount: 1, rankingScore: 1, fulfillmentSettings: 1,
						operatingHours: 1, distanceMeters: 1,
					},
				},
				{ $sort: { rankingScore: -1, averageRating: -1 } },
				{ $limit: 200 },
			]);
			return res.json({ success: true, data: vendors });
		}

		const vendors = await VendorProfile.find(baseFilter)
			.select(
				"name bannerUrl logoUrl profileImage location storeDetails averageRating ratingCount rankingScore fulfillmentSettings operatingHours",
			)
			.sort({ rankingScore: -1, averageRating: -1 })
			.limit(200)
			.lean();
		res.json({ success: true, data: vendors });
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

// Get popular vendors
const getPopularVendors = async (req, res) => {
	try {
		const { zone } = req.query;
		const vendors = await vendorService.getPopularVendors(zone);
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
		const vendor = await vendorService.getVendorProfile(req.user.id);
		res.json(vendor);
	} catch (err) {
		if (err.message === "Vendor not found")
			return res.status(404).json({ message: err.message });
		res.status(500).json({ message: err.message });
	}
};

const getVendors = async (req, res) => {
	try {
		const result = await paginate(VendorProfile, req.query);
		res.status(200).json(result);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

//Customer side
//with this you'll get the vendor details along with their menu and options
const userGetVendor = async (req, res) => {
	try {
		const vendorId = req.params.id;
		if (!mongoose.Types.ObjectId.isValid(vendorId)) {
			return res.status(400).json({ message: "Invalid Vendor ID format" });
		}

		let customerLocation = null;
		if (req.user) {
			const { Customer } = require("../models");
			const customer = await Customer.findOne({ user: req.user.id });
			customerLocation = customer?.savedAddresses?.[0]?.address || null;
		}

		const vendor = await vendorService.getVendorWithProducts(vendorId, customerLocation);
		res.status(200).json(vendor);
	} catch (err) {
		logger.error(`USER_GET_VENDOR_ERROR: ${err.message}`);
		if (err.message === "Vendor not found")
			return res.status(404).json({ message: err.message });
		res.status(500).json({ message: "Internal Server Error", error: err.message });
	}
};

const updateBankDetails = async (req, res) => {
	try {
		const result = await vendorService.updateBankDetails(req.user.id, req.body);
		res.json(result);
	} catch (err) {
		logger.error(`Update bank details failed: ${err.message}`);
		if (err.message.includes("required"))
			return res.status(400).json({ error: err.message });
		res.status(500).json({ error: err.message });
	}
};

// NEW: Get Nearby Vendors
const getNearbyVendors = async (req, res) => {
	try {
		const { lat, lng } = req.query;
		const userId = req.user ? req.user.id : null;

		const result = await vendorService.getNearbyVendors({ lat, lng, userId });

		res.status(200).json(result);
	} catch (err) {
		logger.error(`Nearby Vendors Error: ${err.message}`);
		res.status(500).json({
			message: "Error retrieving vendors",
			error: err.message,
		});
	}
};

const completeVendorRegistration = async (req, res) => {
	try {
		const data = { ...req.body };
		const fileUrl = req.file ? req.file.path : null;

		const result = await vendorService.completeRegistration(
			req.user.id,
			data,
			fileUrl,
		);

		if (result.success === false) {
			return res.status(result.status || 400).json(result);
		}

		res.status(200).json(result);
		logger.info(`Vendor registration completed: ${req.user.id}`);
	} catch (error) {
		logger.error(`Error completing vendor registration: ${error.message}`);

		if (error.message.includes("required") || error.message.includes("Invalid")) {
			return res.status(400).json({ success: false, message: error.message });
		}
		if (error.message === "Vendor not found") {
			return res.status(404).json({ success: false, message: error.message });
		}
		if (error.message === "Vendor profile already completed") {
			return res.status(400).json({ success: false, message: error.message });
		}

		res.status(500).json({
			success: false,
			message: "An error occurred while completing vendor registration",
			error: error.message,
		});
	}
};

const updateVendorProfileImage = async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Profile image file is required",
			});
		}

		const result = await vendorService.uploadAndUpdateVendorProfileImage(
			req.user.id,
			req.file,
		);

		return res.status(200).json(result);
	} catch (error) {
		logger.error(`Update Vendor Profile Image Error: ${error.message}`);
		return res.status(500).json({
			success: false,
			message: error.message || "Error updating profile image",
		});
	}
};

const deleteVendorProfileImage = async (req, res) => {
	try {
		const result = await vendorService.deleteVendorProfileImage(req.user.id);
		return res.status(200).json(result);
	} catch (error) {
		logger.error(`Delete Vendor Profile Image Error: ${error.message}`);
		return res.status(500).json({
			success: false,
			message: error.message || "Error deleting profile image",
		});
	}
};

const updateVendorLocation = async (req, res) => {
	try {
		const { address, coordinates, zone } = req.body;
		if (!address || !Array.isArray(coordinates) || coordinates.length !== 2) {
			return res.status(400).json({
				success: false,
				message: "address and coordinates [longitude, latitude] are required",
			});
		}

		// Resolve zone: use explicit zone from request, else infer from address
		const { identifyZone } = require("../utils/delivery");
		const resolvedZone = zone || identifyZone(address);
		logger.info(`[VendorLocation] Resolved zone="${resolvedZone}" for vendor ${req.user.id}`);

		await VendorProfile.findOneAndUpdate(
			{ owner: req.user.id },
			{
				location: {
					type: "Point",
					coordinates,
					address,
				},
				zone: resolvedZone !== "Other" ? resolvedZone : null,
			},
			{ new: true },
		);
		return res.status(200).json({ success: true, message: "Location updated", zone: resolvedZone });
	} catch (error) {
		logger.error(`Update Vendor Location Error: ${error.message}`);
		return res.status(500).json({
			success: false,
			message: error.message || "Error updating vendor location",
		});
	}
};

const updateVendorProfile = async (req, res) => {
	try {
		const { storeName } = req.body;
		if (!storeName || !storeName.trim()) {
			return res.status(400).json({ success: false, message: "Store name is required" });
		}
		const vendor = await VendorProfile.findOneAndUpdate(
			{ owner: req.user.id },
			{ $set: { "storeDetails.0.storeName": storeName.trim() } },
			{ new: true },
		);
		if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
		return res.status(200).json({ success: true, message: "Profile updated", vendor });
	} catch (error) {
		logger.error(`Update Vendor Profile Error: ${error.message}`);
		return res.status(500).json({ success: false, message: error.message || "Error updating profile" });
	}
};

const deactivateVendorAccount = async (req, res) => {
	try {
		const result = await vendorService.deactivateVendorAccount(req.user.id);
		return res.status(200).json(result);
	} catch (error) {
		logger.error(`Deactivate Vendor Account Error: ${error.message}`);
		return res.status(500).json({
			success: false,
			message: error.message || "Error deactivating vendor account",
		});
	}
};

const toggleVendorOnlineStatus = async (req, res) => {
	try {
		const vendor = await VendorProfile.findOne({ owner: req.user.id });
		if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

		const currentlyOnline = vendor.storeDetails?.[0]?.status === "active";
		const newStatus = currentlyOnline ? "deactivated" : "active";

		if (currentlyOnline) {
			const { Order } = require("../models");
			const activeOrder = await Order.findOne({
				vendor: vendor._id,
				status: { $in: ["confirming", "pending"] },
			}).select("_id").lean();
			if (activeOrder) {
				return res.status(400).json({
					success: false,
					blocked: true,
					message: "You have an active order. Complete it before going offline.",
				});
			}
		}

		if (vendor.storeDetails?.[0]) {
			vendor.storeDetails[0].status = newStatus;
		} else {
			vendor.storeDetails = [{ status: newStatus }];
		}
		await vendor.save();

		const isOnline = newStatus === "active";
		return res.json({
			success: true,
			isOnline,
			isActive: vendor.isActive,
			message: `Store is now ${isOnline ? "online" : "offline"}`,
		});
	} catch (error) {
		logger.error(`Toggle vendor status error: ${error.message}`);
		return res.status(500).json({ success: false, message: error.message });
	}
};

const getVendorWallet = async (req, res) => {
	try {
		const vendorProfile = await VendorProfile.findOne({ owner: req.user.id }).select("_id");
		if (!vendorProfile) {
			return res.status(404).json({ success: false, message: "Vendor profile not found" });
		}

		const [balance, todayEarnings, { transactions }] = await Promise.all([
			ledgerService.getAccountBalance(vendorProfile._id, "VENDOR"),
			ledgerService.getDailyEarnings(vendorProfile._id, "VENDOR"),
			ledgerService.getTransactionHistory(vendorProfile._id, "VENDOR", 20, 0),
		]);

		return res.status(200).json({
			success: true,
			wallet: {
				availableBalance: toNaira(balance.availableBalance),
				pendingBalance: toNaira(balance.pendingBalance),
				holdBalance: toNaira(balance.holdBalance),
				totalBalance: toNaira(balance.totalBalance),
				todayEarnings: toNaira(todayEarnings),
				currency: "NGN",
			},
			transactions: transactions.map((tx) => ({
				...(tx.toObject ? tx.toObject() : tx),
				amount: toNaira(tx.amount),
			})),
		});
	} catch (err) {
		logger.error(`Get Vendor Wallet Error: ${err.message}`);
		return res.status(500).json({
			success: false,
			message: "Error fetching wallet info",
			error: err.message,
		});
	}
};

/**
 * PUT /api/vendors/profile/periods
 * Replace the entire operating schedule (timePeriod or preorderPeriods).
 * Send an empty array [] to clear.
 */
const updateOperatingPeriods = async (req, res) => {
	try {
		const { periods } = req.body;

		if (!Array.isArray(periods)) {
			return res.status(400).json({
				success: false,
				message: "periods must be an array",
			});
		}

		const result = await vendorService.updateOperatingPeriods(
			req.user.id,
			periods,
		);
		return res.status(200).json({ success: true, data: result });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

/**
 * POST /api/vendors/profile/periods
 * Append a single period entry to the existing schedule without touching
 * the rest. Validates using the same rules as updateOperatingPeriods.
 */
const addOperatingPeriod = async (req, res) => {
	try {
		const result = await vendorService.addOperatingPeriod(
			req.user.id,
			req.body,
		);
		return res.status(201).json({ success: true, data: result });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

/**
 * DELETE /api/vendors/profile/periods/:index
 * Remove a single period entry by its array index.
 */
const deleteOperatingPeriod = async (req, res) => {
	try {
		const index = parseInt(req.params.index, 10);
		if (isNaN(index) || index < 0) {
			return res.status(400).json({ success: false, message: "Invalid period index" });
		}
		const result = await vendorService.deleteOperatingPeriod(req.user.id, index);
		return res.status(200).json({ success: true, data: result });
	} catch (error) {
		return res.status(400).json({ success: false, message: error.message });
	}
};

module.exports = {
	completeVendorRegistration,
	getPopularVendors,
	getAllVendors,
	getVendor,
	userGetVendor,
	updateBankDetails,
	getNearbyVendors,
	updateVendorProfileImage,
	deleteVendorProfileImage,
	getVendors,
	deactivateVendorAccount,
	updateVendorLocation,
	updateVendorProfile,
	toggleVendorOnlineStatus,
	getVendorWallet,
	updateOperatingPeriods,
	addOperatingPeriod,
	deleteOperatingPeriod,
};