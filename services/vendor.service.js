const { VendorProfile, Customer } = require("../models");
const { deleteImage } = require("../config/cloudinary");
const payoutService = require("./payout.service");
const { parseTime: _parseTime } = require("../utils/time");
const {DAYS_OF_WEEK} = require("../utils/constants");


class VendorService {
	/**
	 * Get nearby vendors based on location
	 */
	async getNearbyVendors({ lat, lng, userId }) {
		if ((!lat || !lng) && userId) {
			const customer = await Customer.findOne({ user: userId });
			if (customer?.savedAddresses?.[0]?.coordinates) {
				lng = customer.savedAddresses[0].coordinates[0];
				lat = customer.savedAddresses[0].coordinates[1];
			}
		}

		// Show all active vendor accounts — online AND offline.
		// The frontend displays an Open/Closed badge based on storeDetails[0].status.
		const baseFilter = {
			isActive: true,
			storeDetails: { $exists: true, $not: { $size: 0 } },
		};

		if (lat && lng) {
			const coordinates = [parseFloat(lng), parseFloat(lat)];

			// Fetch vendors within 10km sorted by distance (closest first)
			const nearbyVendors = await VendorProfile.aggregate([
				{
					$geoNear: {
						near: { type: "Point", coordinates },
						distanceField: "distanceMeters",
						maxDistance: 10000,
						query: baseFilter,
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
						query: baseFilter,
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

		const allVendors = await VendorProfile.find(baseFilter).limit(20);

		return {
			status: "success",
			source: "default-fallback",
			results: allVendors.length,
			data: allVendors,
		};
	}

	async getPopularVendors(zone) {
		// Show all active vendor accounts — online AND offline.
		// The frontend displays an Open/Closed badge based on storeDetails[0].status.
		const filter = {
			isActive: true,
			storeDetails: { $exists: true, $not: { $size: 0 } },
		};
		if (zone) {
			filter["location.address"] = { $regex: zone, $options: "i" };
		}
		// Sort: online vendors first, then by rating
		return VendorProfile.find(filter)
			.sort({ "storeDetails.0.status": -1, averageRating: -1 })
			.limit(20);
	}

	/**
	 * Vendor private profile (for vendor viewing their own profile)
	 * Includes sensitive info like bank details
	 * @param {string} userId - The User ID (from req.user.id)
	 */
	async getVendorProfile(userId) {
		const vendor = await VendorProfile.findOne({ owner: userId })
			.select(
				"+bankDetails.accountNumber +bankDetails.bankCode +bankDetails.accountName",
			)
			.populate("owner", "phone email"); // Include phone/email from User

		if (!vendor) throw new Error("Vendor not found");

		// Compute order stats (non-blocking — return zeros on error)
		let totalOrders = 0;
		let ordersToday = 0;
		try {
			const Order = require("../models/Order");
			const todayStart = new Date();
			todayStart.setHours(0, 0, 0, 0);
			const todayEnd = new Date();
			todayEnd.setHours(23, 59, 59, 999);
			[totalOrders, ordersToday] = await Promise.all([
				Order.countDocuments({ vendor: vendor._id, status: "delivered" }),
				Order.countDocuments({
					vendor: vendor._id,
					createdAt: { $gte: todayStart, $lte: todayEnd },
					status: {
						$in: ["delivered", "confirming", "packaging", "riding"],
					},
				}),
			]);
		} catch {
			/* non-fatal */
		}

		const data = vendor.toJSON();
		return { ...data, img: data.profileImage ?? null, totalOrders, ordersToday };
	}

	/**
	 * Get vendor details with products (for customers viewing vendor)
	 * @param {string} vendorId - The VendorProfile document ID
	 */
	async getVendorWithProducts(vendorId, customerLocation) {
		const { getEstimatedDeliveryTime } = require("../utils/delivery");

		const vendor = await VendorProfile.findById(vendorId);
		if (!vendor) throw new Error("Vendor not found");

		const FoodItem = require("../models").FoodItem;
		const Combo = require("../models").Combo;

		const [foodItems, combos] = await Promise.all([
			FoodItem.find({ vendor: vendor._id, isAvailable: true }).select(
				"name price description category subCategory img preparationTime",
			),
			Combo.find({ vendor: vendor._id, isAvailable: { $ne: false } }).select(
				"comboName basePrice description img time selections",
			),
		]);

		// Calculate ETA if customer location provided
		let estimatedDeliveryTime = null;
		if (customerLocation && vendor.location?.address) {
			estimatedDeliveryTime = await getEstimatedDeliveryTime(
				vendor.location.address,
				customerLocation,
			);
		}

		const isOnline = vendor.storeDetails?.[0]?.status === "active";
		const vendorJson = vendor.toJSON();
		delete vendorJson.storeDetails;
		delete vendorJson.balance;
		delete vendorJson.earnings;
		delete vendorJson.bankDetails;

		return {
			...vendorJson,
			isOnline,
			foodItems,
			combos,
			estimatedDeliveryTime,
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
		).select(
			"+bankDetails.accountNumber +bankDetails.bankCode +bankDetails.accountName",
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

			if (Array.isArray(data.preorderPeriods)) {
				periods = data.preorderPeriods;
			} else if (typeof data.preorderPeriods === "string") {
				periods = JSON.parse(data.preorderPeriods);
			}

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

			if (Array.isArray(data.timePeriod)) {
				periods = data.timePeriod;
			} else if (typeof data.timePeriod === "string") {
				const parsed = JSON.parse(data.timePeriod);
				if (Array.isArray(parsed)) {
					periods = parsed;
				} else if (typeof parsed === "object" && parsed !== null) {
					if (Array.isArray(parsed.periods)) {
						periods = parsed.periods;
					} else if (Array.isArray(parsed.items)) {
						periods = parsed.items;
					} else {
						periods = [parsed];
					}
				}
			} else if (
				typeof data.timePeriod === "object" &&
				!Array.isArray(data.timePeriod)
			) {
				periods = [data.timePeriod];
			}

			if (Array.isArray(periods)) {
				periods.forEach((period, index) => {
					if (!period.day || !period.openingHour || !period.closingHour) {
						throw new Error(
							`Time period at index ${index} is missing required fields (day, openingHour, closingHour)`,
						);
					}
					if (!DAYS_OF_WEEK.includes(period.day.toLowerCase())) {
						throw new Error(
							`Time period at index ${index} has invalid day value. Must be one of: ${DAYS_OF_WEEK.join(", ")}`,
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
			img: file.path,
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

	/**
	 * Update the vendor's operating periods.
	 *
	 * Behavior is determined by the vendor's servicesOffered:
	 *   - "preOrderMeals"              → updates preorderPeriods
	 *   - "InstantMeals" / "hybridMeals" → updates timePeriod
	 *
	 * Sending an empty array clears the respective schedule.
	 *
	 * timePeriod entry:      { day, openingHour, closingHour }
	 * preorderPeriod entry:  { orderingTime, preparationTime, period }
	 *
	 * @param {string} userId
	 * @param {Array}  periods  — array of period objects (type inferred from servicesOffered)
	 */
	async updateOperatingPeriods(userId, periods) {
		if (!Array.isArray(periods)) {
			throw new Error("periods must be an array");
		}

		const vendor = await VendorProfile.findOne({ owner: userId });
		if (!vendor) throw new Error("Vendor not found");

		if (!vendor.storeDetails || vendor.storeDetails.length === 0) {
			throw new Error("Complete your store registration before updating periods");
		}

		const servicesOffered = vendor.storeDetails[0].servicesOffered;

		// ── preOrderMeals → update preorderPeriods ────────────────────────────
		if (servicesOffered === "preOrderMeals") {
			if (periods.length > 0) {
				const VALID_MEAL_PERIODS = ["breakfast", "lunch", "dinner"];

				periods.forEach((entry, index) => {
					if (!entry.orderingTime) {
						throw new Error(
							`preorderPeriods[${index}]: orderingTime is required`,
						);
					}
					if (!entry.preparationTime) {
						throw new Error(
							`preorderPeriods[${index}]: preparationTime is required`,
						);
					}
					if (!entry.period) {
						throw new Error(
							`preorderPeriods[${index}]: period is required`,
						);
					}
					if (!VALID_MEAL_PERIODS.includes(entry.period)) {
						throw new Error(
							`preorderPeriods[${index}]: invalid period "${entry.period}". Must be one of: ${VALID_MEAL_PERIODS.join(", ")}`,
						);
					}
				});
			}

			vendor.storeDetails[0].preorderPeriods = periods.map((p) => ({
				orderingTime: p.orderingTime,
				preparationTime: p.preparationTime,
				period: p.period,
			}));

			vendor.markModified("storeDetails");
			await vendor.save();

			return {
				success: true,
				message: "Preorder periods updated",
				servicesOffered,
				preorderPeriods: vendor.storeDetails[0].preorderPeriods,
			};
		}

		// InstantMeals / hybridMeals → update timePeriod
		if (
			servicesOffered === "InstantMeals" ||
			servicesOffered === "hybridMeals"
		) {
			if (periods.length > 0) {
				periods.forEach((entry, index) => {
					if (!DAYS_OF_WEEK.includes(entry.day?.toLowerCase())) {
						throw new Error(
							`timePeriod[${index}]: invalid day "${entry.day}". Must be one of: ${DAYS_OF_WEEK.join(", ")}`,
						);
					}
					if (_parseTime(entry.openingHour) === null) {
						throw new Error(
							`timePeriod[${index}]: invalid openingHour "${entry.openingHour}". Use "HH:MM" or "H:MM AM/PM"`,
						);
					}
					if (_parseTime(entry.closingHour) === null) {
						throw new Error(
							`timePeriod[${index}]: invalid closingHour "${entry.closingHour}". Use "HH:MM" or "H:MM AM/PM"`,
						);
					}
				});
			}

			// Normalize day names to lowercase
			vendor.storeDetails[0].timePeriod = periods.map((t) => ({
				day: t.day.toLowerCase(),
				openingHour: t.openingHour,
				closingHour: t.closingHour,
			}));

			vendor.markModified("storeDetails");
			await vendor.save();

			return {
				success: true,
				message: "Operating schedule updated",
				servicesOffered,
				timePeriod: vendor.storeDetails[0].timePeriod,
			};
		}

		throw new Error(
			`Unknown servicesOffered type "${servicesOffered}". Cannot update periods.`,
		);
	}

	/**
	 * Append a single period entry to the existing schedule.
	 * Validates the entry using the same rules as updateOperatingPeriods.
	 *
	 * @param {string} userId
	 * @param {object} entry  — single period object
	 */
	async addOperatingPeriod(userId, entry) {
		const vendor = await VendorProfile.findOne({ owner: userId });
		if (!vendor) throw new Error("Vendor not found");

		if (!vendor.storeDetails || vendor.storeDetails.length === 0) {
			throw new Error("Complete your store registration before adding periods");
		}

		const servicesOffered = vendor.storeDetails[0].servicesOffered;

		// ── preOrderMeals ─────────────────────────────────────────────────────
		if (servicesOffered === "preOrderMeals") {
			const VALID_MEAL_PERIODS = ["breakfast", "lunch", "dinner"];

			if (!entry.orderingTime) throw new Error("orderingTime is required");
			if (!entry.preparationTime) throw new Error("preparationTime is required");
			if (!entry.period) throw new Error("period is required");
			if (!VALID_MEAL_PERIODS.includes(entry.period)) {
				throw new Error(
					`Invalid period "${entry.period}". Must be one of: ${VALID_MEAL_PERIODS.join(", ")}`,
				);
			}

			// Prevent duplicate meal periods (e.g. two "breakfast" entries)
			const existing = vendor.storeDetails[0].preorderPeriods || [];
			if (existing.some((p) => p.period === entry.period)) {
				throw new Error(
					`A "${entry.period}" period already exists. Update or delete it first.`,
				);
			}

			vendor.storeDetails[0].preorderPeriods = [
				...existing,
				{
					orderingTime: entry.orderingTime,
					preparationTime: entry.preparationTime,
					period: entry.period,
				},
			];

			vendor.markModified("storeDetails");
			await vendor.save();

			return {
				success: true,
				message: "Preorder period added",
				servicesOffered,
				preorderPeriods: vendor.storeDetails[0].preorderPeriods,
			};
		}

		// ── InstantMeals / hybridMeals ────────────────────────────────────────
		if (
			servicesOffered === "InstantMeals" ||
			servicesOffered === "hybridMeals"
		) {
			if (!DAYS_OF_WEEK.includes(entry.day?.toLowerCase())) {
				throw new Error(
					`Invalid day "${entry.day}". Must be one of: ${DAYS_OF_WEEK.join(", ")}`,
				);
			}
			if (_parseTime(entry.openingHour) === null) {
				throw new Error(
					`Invalid openingHour "${entry.openingHour}". Use "HH:MM" or "H:MM AM/PM"`,
				);
			}
			if (_parseTime(entry.closingHour) === null) {
				throw new Error(
					`Invalid closingHour "${entry.closingHour}". Use "HH:MM" or "H:MM AM/PM"`,
				);
			}

			// Prevent duplicate day entries
			const existing = vendor.storeDetails[0].timePeriod || [];
			if (existing.some((t) => t.day === entry.day.toLowerCase())) {
				throw new Error(
					`A period for "${entry.day}" already exists. Update or delete it first.`,
				);
			}

			vendor.storeDetails[0].timePeriod = [
				...existing,
				{
					day: entry.day.toLowerCase(),
					openingHour: entry.openingHour,
					closingHour: entry.closingHour,
				},
			];

			vendor.markModified("storeDetails");
			await vendor.save();

			return {
				success: true,
				message: "Operating period added",
				servicesOffered,
				timePeriod: vendor.storeDetails[0].timePeriod,
			};
		}

		throw new Error(
			`Unknown servicesOffered type "${servicesOffered}". Cannot add period.`,
		);
	}

	/**
	 * Remove a single period entry by its array index.
	 *
	 * @param {string} userId
	 * @param {number} index  — zero-based index into the periods array
	 */
	async deleteOperatingPeriod(userId, index) {
		const vendor = await VendorProfile.findOne({ owner: userId });
		if (!vendor) throw new Error("Vendor not found");

		if (!vendor.storeDetails || vendor.storeDetails.length === 0) {
			throw new Error("Complete your store registration before managing periods");
		}

		const servicesOffered = vendor.storeDetails[0].servicesOffered;

		if (servicesOffered === "preOrderMeals") {
			const periods = vendor.storeDetails[0].preorderPeriods || [];
			if (index >= periods.length) {
				throw new Error(`Index ${index} is out of range. Only ${periods.length} period(s) exist.`);
			}
			periods.splice(index, 1);
			vendor.storeDetails[0].preorderPeriods = periods;
			vendor.markModified("storeDetails");
			await vendor.save();

			return {
				success: true,
				message: "Preorder period removed",
				servicesOffered,
				preorderPeriods: vendor.storeDetails[0].preorderPeriods,
			};
		}

		if (
			servicesOffered === "InstantMeals" ||
			servicesOffered === "hybridMeals"
		) {
			const periods = vendor.storeDetails[0].timePeriod || [];
			if (index >= periods.length) {
				throw new Error(`Index ${index} is out of range. Only ${periods.length} period(s) exist.`);
			}
			periods.splice(index, 1);
			vendor.storeDetails[0].timePeriod = periods;
			vendor.markModified("storeDetails");
			await vendor.save();

			return {
				success: true,
				message: "Operating period removed",
				servicesOffered,
				timePeriod: vendor.storeDetails[0].timePeriod,
			};
		}

		throw new Error(
			`Unknown servicesOffered type "${servicesOffered}". Cannot delete period.`,
		);
	}
}

module.exports = new VendorService();