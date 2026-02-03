const Vendor = require("../models/Vendor");
const Customer = require("../models/Customer");
const { deleteImage } = require("../config/cloudinary");
const payoutService = require("./payout.service");

class VendorService {
	/**
	 * Get nearby vendors based on location
	 */
	async getNearbyVendors({ lat, lng, userId }) {
		// ... (Keep existing logic, it was fine)
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

	async deactivateVendor(vendorId) {
		const vendor = await Vendor.findById(vendorId);

		if (!vendor) {
			throw new Error("Vendor not found");
		}

		if (vendor.storeDetails && vendor.storeDetails.length > 0) {
			vendor.storeDetails.forEach((store) => {
				store.status = "deactivated";
			});
		}
		vendor.isAvailable = false;

		await vendor.save();

		return {
			success: true,
			message:
				"Vendor account has been deactivated. Contact support to reactivate.",
			vendor: {
				id: vendor._id,
				storeName: vendor.storeDetails[0]?.storeName,
				status: "deactivated",
				isAvailable: false,
			},
		};
	}

	async getVendorProfile(vendorId) {
		const vendor = await Vendor.findById(vendorId).populate("menu");
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
			{ bankDetails: { accountNumber, bankCode, accountName } },
			{ new: true },
		);
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
		// 1. Validate Initial Input
		this._validateBasicRegistrationData(data, fileUrl);

		// 2. Fetch and Validate Vendor State
		const vendor = await Vendor.findById(vendorId);
		if (!vendor) throw new Error("Vendor not found");
		if (vendor.storeDetails && vendor.storeDetails.length > 0) {
			throw new Error("Vendor profile already completed");
		}

		// 3. Determine Account Status logic
		const statusResult = this._determineAccountStatus(data);
		if (statusResult.shouldReturnError) {
			return statusResult.response;
		}

		// 4. Build Store Details
		const storeDetailsData = this._buildStoreDetails(
			data,
			fileUrl,
			statusResult,
		);

		// 5. Build Period Data (Pre-order or Instant)
		this._attachServicePeriods(storeDetailsData, data);

		// 6. Save
		vendor.storeDetails = [storeDetailsData];
		if (vendor.balance == null) vendor.balance = 0;
		await vendor.save();

		// 7. Format Response
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
			throw new Error(
				"Invalid store type. Must be 'physicalStore' or 'onlineStore'",
			);
		}
		if (
			!["InstantMeals", "preOrderMeals", "hybridMeals"].includes(
				servicesOffered,
			)
		) {
			throw new Error(
				"Invalid services offered. Must be 'InstantMeals', 'preOrderMeals', or 'hybridMeals'",
			);
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
			// Pending status logic
			const status = "pending";
			const needsCACSupport = needCACHelp === "yes";
			let warningMessage = "";

			if (needsCACSupport) {
				warningMessage =
					"Your account is pending. Our support team will contact you regarding CAC registration assistance.";
			} else {
				warningMessage =
					"Please do well to complete your CAC registration so that your business will be safe from legal fines.";
			}
			return {
				shouldReturnError: false,
				status,
				needsCACSupport,
				warningMessage,
				isVerifiedBusiness,
			};
		}

		// Verified Business Logic
		if (!CACNumber) {
			throw new Error("CAC number is required for verified businesses");
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

	_parsePreorderPeriods(data) {
		let periods = [];
		if (data.preorderPeriods && Array.isArray(data.preorderPeriods)) {
			periods = data.preorderPeriods;
		} else {
			// Flatten generic parsing logic if possible, or keep as is if input format varies
			let i = 0;
			while (data[`preorderPeriods[${i}][orderingTime]`]) {
				periods.push({
					orderingTime: data[`preorderPeriods[${i}][orderingTime]`],
					preparationTime: data[`preorderPeriods[${i}][preparationTime]`],
					period: data[`preorderPeriods[${i}][period]`],
				});
				i++;
			}
			// Logic for single fields fallback (orderingTime, preparationTime, period)
			if (
				periods.length === 0 &&
				data.orderingTime &&
				data.preparationTime &&
				data.period
			) {
				periods.push({
					orderingTime: data.orderingTime,
					preparationTime: data.preparationTime,
					period: data.period,
				});
			}
		}

		if (periods.length === 0) {
			throw new Error(
				"At least one preorder period (orderingTime, preparationTime, and period) is required for pre-order services",
			);
		}

		for (const pp of periods) {
			if (!pp.orderingTime || !pp.preparationTime || !pp.period) {
				throw new Error(
					"Each preorder period must include orderingTime, preparationTime, and period",
				);
			}
			if (!["breakfast", "lunch", "dinner"].includes(pp.period)) {
				throw new Error(
					`Invalid period: ${pp.period}. Must be one of 'breakfast', 'lunch', or 'dinner'`,
				);
			}
		}
		return periods;
	}

	_parseTimePeriods(data) {
		let periods = [];
		if (data.timePeriod && Array.isArray(data.timePeriod)) {
			periods = data.timePeriod;
		} else {
			let i = 0;
			while (data[`timePeriod[${i}][day]`]) {
				periods.push({
					day: data[`timePeriod[${i}][day]`],
					openingHour: data[`timePeriod[${i}][openingHour]`],
					closingHour: data[`timePeriod[${i}][closingHour]`],
				});
				i++;
			}
			if (
				periods.length === 0 &&
				data.day &&
				data.openingHour &&
				data.closingHour
			) {
				periods.push({
					day: data.day,
					openingHour: data.openingHour,
					closingHour: data.closingHour,
				});
			}
		}

		if (periods.length === 0) {
			throw new Error(
				"At least one time period is required for instant/hybrid meal services",
			);
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

		return periods.map((tp) => {
			if (!tp.day || !tp.openingHour || !tp.closingHour) {
				throw new Error(
					"Each time period must include day, openingHour, and closingHour",
				);
			}
			const day = tp.day.toLowerCase();
			if (!validDays.includes(day)) {
				throw new Error(
					`Invalid day: ${tp.day}. Must be one of: ${validDays.join(", ")}`,
				);
			}
			return { ...tp, day };
		});
	}

	_formatRegistrationResponse(vendor, storeDetailsData, statusResult) {
		const responseData = {
			vendorId: vendor._id,
			storeName: storeDetailsData.storeName,
			storeType: storeDetailsData.storeType,
			servicesOffered: storeDetailsData.servicesOffered,
			status: statusResult.status,
		};

		if (storeDetailsData.servicesOffered === "preOrderMeals") {
			responseData.preorderPeriods = storeDetailsData.preorderPeriods;
		} else if (storeDetailsData.timePeriod) {
			responseData.timePeriod = storeDetailsData.timePeriod;
		}

		return {
			success: true,
			accountStatus: statusResult.status,
			message:
				statusResult.status === "pending"
					? `Vendor registration completed successfully. ${statusResult.warningMessage}`
					: "Vendor registration completed successfully",
			needsCACSupport: statusResult.needsCACSupport,
			data: responseData,
		};
	}
	async uploadAndUpdateVendorProfileImage(vendorId, file) {
		const vendor = await Vendor.findById(vendorId);
		if (!vendor) {
			throw new Error("Vendor not found");
		}

		if (vendor.img) {
			await this._deleteOldImage(vendor.img);
		}

		vendor.img = file.path;
		await vendor.save();

		return {
			success: true,
			message: "Profile image updated successfully",
			imageUrl: file.path,
			vendor: {
				id: vendor._id,
				name: vendor.name,
				img: vendor.img,
				storeName: vendor.storeDetails?.[0]?.storeName,
			},
		};
	}

	async deleteVendorProfileImage(vendorId) {
		const vendor = await Vendor.findById(vendorId);
		if (!vendor) {
			throw new Error("Vendor not found");
		}

		if (!vendor.img) {
			throw new Error("No profile image to delete");
		}
		await this._deleteOldImage(vendor.img);

		vendor.img = null;
		await vendor.save();
		return {
			success: true,
			message: "Profile image deleted successfully",
		};
	}

	async _deleteOldImage(imageUrl) {
		try {
			const urlParts = imageUrl.split("/");
			const publicIdWithExtension = urlParts[urlParts.length - 1];
			const publicId = publicIdWithExtension.split(".")[0];
			const folder = urlParts[urlParts.length - 2];
			const fullPublicId = `${folder}/${publicId}`;

			await deleteImage(fullPublicId);
		} catch (error) {
			console.error("Error deleting old image:", error);
		}
	}
}

module.exports = new VendorService();
