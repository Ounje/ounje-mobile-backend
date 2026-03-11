const vendorService = require("../services/vendor.service");
const mongoose = require("mongoose"); // needed only for ObjectId validation in userGetVendor (or move validation to service)
const { VendorProfile } = require("../models");
const { paginate } = require("../utils/paginate");
const logger = require("../utils/logger");

// Get popular vendors
const getPopularVendors = async (req, res) => {
	try {
		const vendors = await vendorService.getPopularVendors();
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
		// No filter needed here because we want to see all vendors
		// No populate needed yet, unless you want to see their menu items immediately
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
		// Keep validation here as it's an HTTP concern (bad request), or move to service and catch error.
		// VendorService throws "Vendor not found", but might choke on invalid ID format if not checked.
		// Let's keep ID format check here for clarity.
		if (!mongoose.Types.ObjectId.isValid(vendorId)) {
			return res.status(400).json({ message: "Invalid Vendor ID format" });
		}

		const vendor = await vendorService.getVendorWithProducts(vendorId);

		// Always return a proper JSON object
		res.status(200).json(vendor);
	} catch (err) {
		logger.error(`USER_GET_VENDOR_ERROR: ${err.message}`);
		if (err.message === "Vendor not found")
			return res.status(404).json({ message: err.message });

		res
			.status(500)
			.json({ message: "Internal Server Error", error: err.message });
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

		const result = await vendorService.getNearbyVendors({
			lat,
			lng,
			userId,
		});

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
		// Prepare data from body
		const data = { ...req.body };
		// If file uploaded, get path
		const fileUrl = req.file ? req.file.path : null;

		if (!req.file && !data.ninID) {
			// Basic check here, though service also checks. Service throws if missing.
			// We'll let service handle validation mostly, but valid req.file handling is here.
		}

		const result = await vendorService.completeRegistration(
			req.user.id,
			data,
			fileUrl,
		);

		if (result.success === false) {
			// Handle the specific "needs CAC" case which returns 400 usually
			return res.status(result.status || 400).json(result);
		}

		res.status(200).json(result);
		logger.info(`Vendor registration completed: ${req.user.id}`);
	} catch (error) {
		logger.error(`Error completing vendor registration: ${error.message}`);

		if (
			error.message.includes("required") ||
			error.message.includes("Invalid")
		) {
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
		const vendorId = req.user.id;

		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Profile image file is required",
			});
		}

		const result = await vendorService.uploadAndUpdateVendorProfileImage(
			vendorId,
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
		const vendorId = req.user.id;

		const result = await vendorService.deleteVendorProfileImage(vendorId);

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
		const { address, coordinates } = req.body;
		if (!address || !Array.isArray(coordinates) || coordinates.length !== 2) {
			return res.status(400).json({
				success: false,
				message: "address and coordinates [longitude, latitude] are required",
			});
		}
		await VendorProfile.findOneAndUpdate(
			{ owner: req.user.id },
			{
				location: {
					type: "Point",
					coordinates, // [longitude, latitude]
					address,
				},
			},
			{ new: true },
		);
		return res.status(200).json({ success: true, message: "Location updated" });
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
		const vendorId = req.user.id;
		const result = await vendorService.deactivateVendorAccount(vendorId);
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

		// isActive = account-level activation — NEVER toggled here.
		// Online/offline is tracked via storeDetails[0].status only.
		const currentlyOnline = vendor.storeDetails?.[0]?.status === "active";
		const newStatus = currentlyOnline ? "deactivated" : "active";

		// Guard: vendor cannot go offline while an order is active.
		// Active = confirming (awaiting acceptance) or pending (accepted, preparing).
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
			// storeDetails missing — create the entry
			vendor.storeDetails = [{ status: newStatus }];
		}
		await vendor.save();

		const isOnline = newStatus === "active";
		return res.json({
			success: true,
			isOnline,
			isActive: vendor.isActive, // account status — unchanged
			message: `Store is now ${isOnline ? "online" : "offline"}`,
		});
	} catch (error) {
		logger.error(`Toggle vendor status error: ${error.message}`);
		return res.status(500).json({ success: false, message: error.message });
	}
};

module.exports = {
	completeVendorRegistration,
	getPopularVendors,
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
};
