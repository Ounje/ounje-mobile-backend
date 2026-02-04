const { Vendor, Customer } = require("../models");
const { deleteImage } = require("../config/cloudinary");
const payoutService = require("./payout.service");

class VendorService {
	/**
	 * Get nearby vendors based on location
	 */
	async getNearbyVendors({ lat, lng, userId }) {
		try {
			if ((!lat || !lng) && userId) {
				const customer = await Customer.findById(userId);
				if (customer?.location?.coordinates) {
					lng = customer.location.coordinates[0];
					lat = customer.location.coordinates[1];
				}
			}

			if (lat && lng) {
				const vendors = await Vendor.find({
					isAvailable: { $ne: false },
					location: {
						$near: {
							$geometry: {
								type: "Point",
								coordinates: [parseFloat(lng), parseFloat(lat)],
							},
							$maxDistance: 10000,
						},
					},
				});

				if (vendors.length > 0) {
					return {
						status: "success",
						source: "location-based",
						results: vendors.length,
						data: vendors,
					};
				}
			}

			const allVendors = await Vendor.find({
				isAvailable: { $ne: false },
			}).limit(20);

			return {
				status: "success",
				source: "default-fallback",
				results: allVendors.length,
				data: allVendors,
			};
		} catch (error) {
			throw error;
		}
	}

	async getPopularVendors() {
		return await Vendor.find().sort({ totalOrders: -1 });
	}

	/**
	 * Vendor private profile
	 */
	async getVendorProfile(vendorId) {
		const vendor = await Vendor.findById(vendorId)
			//.select("+bankDetails")
			.populate("menu");

		if (!vendor) throw new Error("Vendor not found");
		return vendor;
	}

	async getVendorWithProducts(vendorId) {
		const vendor = await Vendor.findById(vendorId)
			.populate("menu")
			.populate("foodItems");

		if (!vendor) throw new Error("Vendor not found");
		return vendor;
	}

	async updateBankDetails(vendorId, { accountNumber, bankCode, accountName }) {
		if (!accountNumber || !bankCode || !accountName) {
			throw new Error("accountNumber, bankCode, accountName required");
		}

		const vendor = await Vendor.findByIdAndUpdate(
			vendorId,
			{
				bankDetails: {
					accountNumber,
					bankCode,
					accountName,
				},
			},
			{ new: true },
		).select("+bankDetails");

		if (!vendor) throw new Error("Vendor not found");

		const retryResults = await payoutService.processPendingPayoutsForUser(
			vendor._id,
			"VENDOR",
		);

		return { vendor, retryResults };
	}

	/**
	 * Complete vendor registration
	 */
	async completeRegistration(vendorId, data, fileUrl) {
		this._validateBasicRegistrationData(data, fileUrl);

		const vendor = await Vendor.findById(vendorId);
		if (!vendor) throw new Error("Vendor not found");
		if (vendor.storeDetails && vendor.storeDetails.length > 0) {
			throw new Error("Vendor profile already completed");
		}

		const statusResult = this._determineAccountStatus(data);
		if (statusResult.shouldReturnError) {
			return statusResult.response;
		}

		const storeDetailsData = this._buildStoreDetails(
			data,
			fileUrl,
			statusResult,
		);

		this._attachServicePeriods(storeDetailsData, data);

		vendor.storeDetails = [storeDetailsData];
		if (vendor.balance == null) vendor.balance = 0;
		await vendor.save();

		return this._formatRegistrationResponse(
			vendor,
			storeDetailsData,
			statusResult,
		);
	}

	_validateBasicRegistrationData(data, fileUrl) {
		const { storeName, storeType, servicesOffered } = data;

		if (!storeName || !storeType || !servicesOffered) {
			throw new Error(
				"Store name, store type and services offered are required",
			);
		}

		if (!["physicalStore", "onlineStore"].includes(storeType)) {
			throw new Error("Invalid store type");
		}

		if (
			!["InstantMeals", "preOrderMeals", "hybridMeals"].includes(
				servicesOffered,
			)
		) {
			throw new Error("Invalid services offered");
		}

		if (!fileUrl) {
			throw new Error("NIN ID document is required");
		}
	}

	_determineAccountStatus(data) {
		const isVerifiedBusiness =
			data.isVerifiedBusiness === true || data.isVerifiedBusiness === "true";
		const { needCACHelp, CACNumber } = data;

		if (!isVerifiedBusiness) {
			if (!needCACHelp) {
				return {
					shouldReturnError: true,
					response: {
						success: false,
						message:
							"Your business needs to be registered. Would you like us to help you with CAC registration?",
						needsCAC: true,
						status: 400,
					},
				};
			}

			return {
				shouldReturnError: false,
				status: "pending",
				needsCACSupport: needCACHelp === "yes",
				warningMessage:
					needCACHelp === "yes"
						? "Our support team will contact you regarding CAC registration assistance."
						: "Please complete your CAC registration.",
				isVerifiedBusiness,
			};
		}

		if (!CACNumber) {
			throw new Error("CAC number is required");
		}

		return {
			shouldReturnError: false,
			status: "active",
			needsCACSupport: false,
			warningMessage: null,
			isVerifiedBusiness,
		};
	}

	_buildStoreDetails(data, fileUrl, statusResult) {
		return {
			storeName: data.storeName,
			storeType: data.storeType,
			isVerifiedBusiness: statusResult.isVerifiedBusiness,
			CACNumber: data.CACNumber || null,
			servicesOffered: data.servicesOffered,
			ninID: fileUrl,
			status: statusResult.status,
			needsCACSupport: statusResult.needsCACSupport,
		};
	}

	_attachServicePeriods(storeDetailsData, data) {
		if (data.servicesOffered === "preOrderMeals") {
			storeDetailsData.preorderPeriods = this._parsePreorderPeriods(data);
		} else {
			storeDetailsData.timePeriod = this._parseTimePeriods(data);
		}
	}

	async uploadAndUpdateVendorProfileImage(vendorId, file) {
		const vendor = await Vendor.findById(vendorId);
		if (!vendor) throw new Error("Vendor not found");

		if (vendor.img) await this._deleteOldImage(vendor.img);

		vendor.img = file.path;
		await vendor.save();

		return {
			success: true,
			message: "Profile image updated successfully",
			imageUrl: file.path,
		};
	}

	async deleteVendorProfileImage(vendorId) {
		const vendor = await Vendor.findById(vendorId);
		if (!vendor) throw new Error("Vendor not found");

		if (!vendor.img) throw new Error("No profile image to delete");

		await this._deleteOldImage(vendor.img);
		vendor.img = null;
		await vendor.save();

		return { success: true, message: "Profile image deleted successfully" };
	}

	async _deleteOldImage(imageUrl) {
		try {
			const urlParts = imageUrl.split("/");
			const publicIdWithExtension = urlParts[urlParts.length - 1];
			const publicId = publicIdWithExtension.split(".")[0];
			const folder = urlParts[urlParts.length - 2];
			await deleteImage(`${folder}/${publicId}`);
		} catch (error) {
			console.error("Error deleting old image:", error);
		}
	}
}

module.exports = new VendorService();
