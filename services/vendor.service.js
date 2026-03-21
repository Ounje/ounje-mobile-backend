const { VendorProfile, Customer } = require("../models");
const { deleteImage } = require("../config/cloudinary");
const payoutService = require("./payout.service");

class VendorService {
	/**
	 * Get nearby vendors based on location
	 */
	async getNearbyVendors({ lat, lng, userId }) {
		try {
			if ((!lat || !lng) && userId) {
				const customer = await Customer.findOne({ user: userId });
				if (customer?.savedAddresses?.[0]?.coordinates) {
					lng = customer.savedAddresses[0].coordinates[0];
					lat = customer.savedAddresses[0].coordinates[1];
				}
			}

			if (lat && lng) {
				const coordinates = [parseFloat(lng), parseFloat(lat)];
				const onlineFilter = { isActive: true, storeDetails: { $exists: true, $not: { $size: 0 } }, "storeDetails.0.status": "active" };

				// Fetch vendors within 10km sorted by distance (closest first)
				const nearbyVendors = await VendorProfile.aggregate([
					{
						$geoNear: {
							near: { type: "Point", coordinates },
							distanceField: "distanceMeters",
							maxDistance: 10000,
							query: onlineFilter,
							spherical: true,
						},
					},
				]);

				// Fetch vendors beyond 10km sorted by distance
				const furtherVendors = await VendorProfile.aggregate([
					{
						$geoNear: {
							near: { type: "Point", coordinates },
							distanceField: "distanceMeters",
							minDistance: 10001,
							query: onlineFilter,
							spherical: true,
						},
					},
				]);

				const data = [...nearbyVendors, ...furtherVendors];

				return {
					status: "success",
					source: "location-based",
					results: data.length,
					nearby: nearbyVendors.length,
					further: furtherVendors.length,
					data,
				};
			}

			const allVendors = await VendorProfile.find({ isActive: true, storeDetails: { $exists: true, $not: { $size: 0 } }, "storeDetails.0.status": "active" }).limit(20);

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

	async getPopularVendors(zone) {
		const filter = { isActive: true, storeDetails: { $exists: true, $not: { $size: 0 } }, "storeDetails.0.status": "active" };
		if (zone) {
			filter["location.address"] = { $regex: zone, $options: "i" };
		}
		return await VendorProfile.find(filter).sort({ averageRating: -1 }).limit(20);
	}

	/**
	 * Vendor private profile (for vendor viewing their own profile)
	 * Includes sensitive info like bank details
	 * @param {string} userId - The User ID (from req.user.id)
	 */
	async getVendorProfile(userId) {
		const vendor = await VendorProfile.findOne({ owner: userId })
			.select("+bankDetails.accountNumber +bankDetails.bankCode +bankDetails.accountName")
			.populate("owner", "phone email"); // Include phone/email from User

		if (!vendor) throw new Error("Vendor not found");

		// Compute order stats (non-blocking — return zeros on error)
		let totalOrders = 0;
		let ordersToday = 0;
		try {
			const Order = require("../models/Order");
			const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
			const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
			[totalOrders, ordersToday] = await Promise.all([
				Order.countDocuments({ vendor: vendor._id, status: "delivered" }),
				Order.countDocuments({
					vendor: vendor._id,
					createdAt: { $gte: todayStart, $lte: todayEnd },
					status: { $in: ["delivered", "confirming", "packaging", "riding"] },
				}),
			]);
		} catch { /* non-fatal */ }

		return { ...vendor.toJSON(), totalOrders, ordersToday };
	}

	/**
	 * Get vendor details with products (for customers viewing vendor)
	 * @param {string} vendorId - The VendorProfile document ID
	 */
	async getVendorWithProducts(vendorId, customerLocation) {
		const { getEstimatedDeliveryTime } = require("../utils/delivery");

		const vendor = await VendorProfile.findById(vendorId).select(
			"-balance -earnings -bankDetails"
		);
		if (!vendor) throw new Error("Vendor not found");

		const FoodItem = require("../models").FoodItem;
		const Combo = require("../models").Combo;

		const [foodItems, combos] = await Promise.all([
			FoodItem.find({ vendor: vendor._id, isAvailable: true }).select(
				"name price description category subCategory img preparationTime"
			),
			Combo.find({ vendor: vendor._id, isAvailable: { $ne: false } }).select(
				"comboName basePrice description img time selections"
			),
		]);

		// Calculate ETA if customer location provided
		let estimatedDeliveryTime = null;
		if (customerLocation && vendor.location?.address) {
			estimatedDeliveryTime = await getEstimatedDeliveryTime(
				vendor.location.address,
				customerLocation
			);
		}

		const isOnline = vendor.storeDetails?.[0]?.status === "active";
		const vendorJson = vendor.toJSON();
		delete vendorJson.storeDetails;

		return {
			...vendorJson,
			isOnline,
			foodItems,
			combos,
			estimatedDeliveryTime, // in minutes, null if not calculable
		};
	}

	async updateBankDetails(userId, { accountNumber, bankCode, accountName }) {
		if (!accountNumber || !bankCode || !accountName) {
			throw new Error("accountNumber, bankCode, accountName required");
		}

		const vendor = await VendorProfile.findOneAndUpdate(
			{ owner: userId },
			{
				bankDetails: {
					accountNumber,
					bankCode,
					accountName,
				},
			},
			{ new: true },
		).select("+bankDetails.accountNumber +bankDetails.bankCode +bankDetails.accountName");

		if (!vendor) throw new Error("Vendor not found");

		const retryResults = await payoutService.processPendingPayoutsForUser(
			vendor._id,
			"VENDOR",
		);

		return { vendor, retryResults };
	}

	/**
	 * Complete vendor registration
	 * @param {string} userId - The User ID (from req.user.id)
	 */
	async completeRegistration(userId, data, fileUrl) {
		this._validateBasicRegistrationData(data, fileUrl);

		const vendor = await VendorProfile.findOne({ owner: userId });
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

		// Validate service periods based on service type
		if (servicesOffered === "preOrderMeals") {
			if (!data.preorderPeriods) {
				throw new Error(
					"At least one preorder period is required for pre-order meals",
				);
			}
			const periods = this._parsePreorderPeriods(data);
			if (!Array.isArray(periods) || periods.length === 0) {
				throw new Error(
					"At least one preorder period is required for pre-order meals",
				);
			}
		} else if (
			servicesOffered === "InstantMeals" ||
			servicesOffered === "hybridMeals"
		) {
			if (!data.timePeriod) {
				throw new Error(
					"At least one time period is required for instant/hybrid meals",
				);
			}
			const periods = this._parseTimePeriods(data);
			if (!Array.isArray(periods) || periods.length === 0) {
				throw new Error(
					"At least one time period is required for instant/hybrid meals",
				);
			}
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

	/**
	 * Parse preorder periods from request data
	 * Expected format: data.preorderPeriods as array or JSON string
	 * Schema expects: Array of { orderingTime, preparationTime, period }
	 */
	_parsePreorderPeriods(data) {
		if (!data.preorderPeriods) {
			return [];
		}

		try {
			let periods = [];

			// If it's already an array, use it
			if (Array.isArray(data.preorderPeriods)) {
				periods = data.preorderPeriods;
			}
			// If it's a JSON string, parse it
			else if (typeof data.preorderPeriods === "string") {
				periods = JSON.parse(data.preorderPeriods);
			}

			// Validate each period has required fields
			if (Array.isArray(periods)) {
				periods.forEach((period, index) => {
					if (
						!period.orderingTime ||
						!period.preparationTime ||
						!period.period
					) {
						throw new Error(
							`Preorder period at index ${index} is missing required fields (orderingTime, preparationTime, period)`,
						);
					}
					if (!["breakfast", "lunch", "dinner"].includes(period.period)) {
						throw new Error(
							`Preorder period at index ${index} has invalid period value. Must be 'breakfast', 'lunch', or 'dinner'`,
						);
					}
				});
				return periods;
			}

			return [];
		} catch (error) {
			console.error("Error parsing preorder periods:", error);
			throw error;
		}
	}

	/**
	 * Parse time periods from request data
	 * Expected format: data.timePeriod as array or JSON string
	 * Schema expects: Array of { day, openingHour, closingHour }
	 */
	_parseTimePeriods(data) {
		if (!data.timePeriod) {
			return [];
		}

		try {
			let periods = [];

			// If it's already an array, use it
			if (Array.isArray(data.timePeriod)) {
				periods = data.timePeriod;
			}
			// If it's a JSON string, parse it
			else if (typeof data.timePeriod === "string") {
				const parsed = JSON.parse(data.timePeriod);
				// If parsed result is an array, use it
				if (Array.isArray(parsed)) {
					periods = parsed;
				}
				// If it's an object with array properties, try to extract the array
				else if (typeof parsed === "object" && parsed !== null) {
					// Check if it has a periods or items property that's an array
					if (Array.isArray(parsed.periods)) {
						periods = parsed.periods;
					} else if (Array.isArray(parsed.items)) {
						periods = parsed.items;
					}
					// Otherwise wrap single object in array
					else {
						periods = [parsed];
					}
				}
			}
			// If it's a single object, wrap it in an array
			else if (
				typeof data.timePeriod === "object" &&
				!Array.isArray(data.timePeriod)
			) {
				periods = [data.timePeriod];
			}

			// Validate each period has required fields
			if (Array.isArray(periods)) {
				const validDays = [
					"sunday",
					"monday",
					"tuesday",
					"wednesday",
					"thursday",
					"friday",
					"saturday",
				];

				periods.forEach((period, index) => {
					if (!period.day || !period.openingHour || !period.closingHour) {
						throw new Error(
							`Time period at index ${index} is missing required fields (day, openingHour, closingHour)`,
						);
					}
					if (!validDays.includes(period.day.toLowerCase())) {
						throw new Error(
							`Time period at index ${index} has invalid day value. Must be one of: ${validDays.join(", ")}`,
						);
					}
				});
				return periods;
			}

			return [];
		} catch (error) {
			console.error("Error parsing time periods:", error);
			throw error;
		}
	}

	/**
	 * Format the registration response
	 */
	_formatRegistrationResponse(vendor, storeDetailsData, statusResult) {
		const response = {
			success: true,
			message:
				statusResult.status === "active"
					? "Vendor registration completed successfully"
					: "Vendor registration submitted and pending verification",
			vendor: {
				id: vendor._id,
				name: vendor.name,
				email: vendor.email,
				phone: vendor.phone,
				storeDetails: storeDetailsData,
			},
			accountStatus: statusResult.status,
		};

		if (statusResult.warningMessage) {
			response.warning = statusResult.warningMessage;
		}

		return response;
	}

	async uploadAndUpdateVendorProfileImage(userId, file) {
		const vendor = await VendorProfile.findOne({ owner: userId });
		if (!vendor) throw new Error("Vendor not found");

		if (vendor.profileImage) await this._deleteOldImage(vendor.profileImage);

		vendor.profileImage = file.path;
		await vendor.save();

		return {
			success: true,
			message: "Profile image updated successfully",
			imageUrl: file.path,
		};
	}

	async deleteVendorProfileImage(userId) {
		const vendor = await VendorProfile.findOne({ owner: userId });
		if (!vendor) throw new Error("Vendor not found");

		if (!vendor.profileImage) throw new Error("No profile image to delete");

		await this._deleteOldImage(vendor.profileImage);
		vendor.profileImage = null;
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

	async deactivateVendorAccount(userId) {
		try {
			const vendor = await VendorProfile.findOne({ owner: userId });
			if (!vendor) throw new Error("Vendor not found");
			vendor.storeDetails[0].status = "deactivated";
			if (vendor.isActive) vendor.isActive = false;
			await vendor.save();
			return {
				success: true,
				message: "Vendor account deactivated successfully",
			};
		} catch (error) {
			console.error("Error deactivating vendor account:", error);
			throw error;
		}
	}
}

module.exports = new VendorService();
