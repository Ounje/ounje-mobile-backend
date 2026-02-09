const { RiderProfile, Rider } = require("../models");
const payoutService = require("./payout.service");
const ratingService = require("./rating.service");
const ledgerService = require("./ledger.service");
const logger = require("../utils/logger");

/**
 * Get Rider Dashboard Data
 * Aggregates Wallet info and daily earnings.
 */
const getRiderDashboard = async (riderId) => {
	// 1. Get Wallet Balances
	const balanceInfo = await ledgerService.getAccountBalance(riderId, "RIDER");

	// 2. Get Today's Earnings
	const todayEarnings = await ledgerService.getDailyEarnings(riderId, "RIDER");

	return {
		wallet: {
			availableBalance: balanceInfo.availableBalance,
			pendingBalance: balanceInfo.pendingBalance,
			totalBalance: balanceInfo.totalBalance,
			currency: "NGN",
		},
		stats: {
			todayEarnings,
		},
	};
};

/**
 * Complete Rider Registration
 * Handles file uploads and saves rider profile data
 */
const completeRiderRegistration = async (userId, data, files) => {
	const {
		modeOfDelivery,
		guarantorName,
		guarantorPhone,
		guarantorNin: guarantorNinNumber,
	} = data;

	const user = await Rider.findById(userId);
	if (!user) throw new Error("Rider account not found");

	// Find or create rider profile
	let riderProfile = await RiderProfile.findOne({ user: userId });
	if (!riderProfile) {
		riderProfile = new RiderProfile({ user: userId });
	}

	if (riderProfile.guarantor && riderProfile.guarantor.name) {
		throw new Error(
			"Registration already completed. Guarantor already exists.",
		);
	}

	if (!modeOfDelivery || !["Bicycle", "Motorcycle"].includes(modeOfDelivery)) {
		throw new Error(
			"Invalid mode of delivery. Must be 'Bicycle' or 'Motorcycle'",
		);
	}

	if (!guarantorName || !guarantorPhone) {
		throw new Error("Guarantor name and phone are required");
	}

	if (!files || !files.guarantorNin || !files.guarantorNin[0]) {
		throw new Error("Guarantor NIN document is required");
	}
	const guarantorNinUrl = files.guarantorNin[0].path;

	let driversLicense = null;
	let nin = null;

	if (modeOfDelivery === "Motorcycle") {
		if (!files || !files.driversLicense || !files.driversLicense[0]) {
			throw new Error(
				"Drivers license document is required for Motorcycle riders",
			);
		}
		driversLicense = files.driversLicense[0].path;
	}

	if (modeOfDelivery === "Bicycle") {
		if (!files || !files.nin || !files.nin[0]) {
			throw new Error("NIN document is required for Bicycle riders");
		}
		nin = files.nin[0].path;
	}

	riderProfile.modeOfDelivery = modeOfDelivery;
	riderProfile.guarantor = {
		name: guarantorName,
		phone: guarantorPhone,
		nin: guarantorNinNumber || guarantorNinUrl, // Use NIN number or document URL
	};

	if (driversLicense) riderProfile.driversLicense = driversLicense;
	if (nin) riderProfile.nin = nin;

	await riderProfile.save();

	return {
		riderId: riderProfile._id,
		userId: user._id,
		name: user.name,
		phone: user.phone,
		status: riderProfile.status,
		modeOfDelivery: riderProfile.modeOfDelivery,
		guarantor: {
			name: riderProfile.guarantor.name,
			phone: riderProfile.guarantor.phone,
		},
		documentsUploaded: {
			driversLicense: !!driversLicense,
			nin: !!nin,
			guarantorNin: true,
		},
	};
};

/**
 * Get Rider Profile
 * Fetches profile and checks for missing fields.
 */
const getRiderProfile = async (userId) => {
	const riderProfile = await RiderProfile.findOne({ user: userId })
		.populate("user", "name phone email")
		.select(
			"modeOfDelivery guarantor driversLicense nin status operatingArea isActive currentLocation earnings ratings averageRating ratingCount",
		);

	if (!riderProfile) throw new Error("Rider profile not found");

	let setupComplete = false;
	let missingFields = [];

	// Check basic fields
	if (!riderProfile.modeOfDelivery) missingFields.push("modeOfDelivery");

	// Check guarantor information
	if (!riderProfile.guarantor) {
		missingFields.push("Guarantor information");
	} else {
		if (!riderProfile.guarantor.name) missingFields.push("guarantor name");
		if (!riderProfile.guarantor.phone) missingFields.push("guarantor phone");
		if (!riderProfile.guarantor.nin)
			missingFields.push("guarantor NIN document");
	}

	// Check mode-specific documents
	if (riderProfile.modeOfDelivery === "Motorcycle") {
		if (!riderProfile.driversLicense)
			missingFields.push("driversLicense document");
	} else if (riderProfile.modeOfDelivery === "Bicycle") {
		if (!riderProfile.nin) missingFields.push("NIN document");
	}

	// Check operating area
	if (!riderProfile.operatingArea || riderProfile.operatingArea.length === 0) {
		missingFields.push("operatingArea");
	}

	setupComplete = missingFields.length === 0;

	// Activate rider if setup is complete
	if (setupComplete && !riderProfile.isActive) {
		riderProfile.isActive = true;
		riderProfile.status = "available"; // Change from pending to available
		await riderProfile.save();
	}

	const responseData = {
		name: riderProfile.user.name,
		phone: riderProfile.user.phone,
		email: riderProfile.user.email,
		modeOfDelivery: riderProfile.modeOfDelivery,
		operatingArea: riderProfile.operatingArea || [],
		guarantor: riderProfile.guarantor || null,
		status: riderProfile.status,
		isActive: riderProfile.isActive,
		setupComplete,
		earnings: riderProfile.earnings,
		ratings: {
			average: riderProfile.ratings?.average || riderProfile.averageRating || 0,
			count: riderProfile.ratings?.count || riderProfile.ratingCount || 0,
		},
	};

	if (!setupComplete) {
		responseData.missingFields = missingFields;
	}

	responseData.documentsUploaded = {
		driversLicense: !!riderProfile.driversLicense,
		nin: !!riderProfile.nin,
		guarantorNin: !!riderProfile.guarantor?.nin,
	};

	return responseData;
};

/**
 * Update/Set Operating Area for Rider
 * Allows riders to select their operating zones (max 2)
 */
const updateOperatingArea = async (userId, body) => {
	const { operatingArea } = body;

	if (!operatingArea || !Array.isArray(operatingArea)) {
		throw new Error("Operating area must be an array of zones");
	}

	if (operatingArea.length === 0) {
		throw new Error("At least one delivery zone must be selected");
	}

	if (operatingArea.length > 2) {
		throw new Error("You can only select a maximum of 2 delivery zones");
	}

	const riderProfile = await RiderProfile.findOneAndUpdate(
		{ user: userId },
		{ operatingArea },
		{ new: true },
	).populate("user", "name phone");

	if (!riderProfile) {
		throw new Error("Rider profile not found");
	}

	logger.info(
		`Rider ${userId} updated operating area: ${operatingArea.join(", ")}`,
	);

	return {
		success: true,
		message: "Operating area updated successfully",
		data: {
			riderId: riderProfile._id,
			name: riderProfile.user.name,
			operatingArea: riderProfile.operatingArea,
		},
	};
};

/**
 * Get Rider Operating Area
 * Fetches the current operating zones for a rider
 */
const getOperatingArea = async (userId) => {
	const riderProfile = await RiderProfile.findOne({ user: userId }).select(
		"operatingArea",
	);

	if (!riderProfile) {
		throw new Error("Rider profile not found");
	}

	return {
		success: true,
		data: {
			operatingArea: riderProfile.operatingArea || [],
		},
	};
};

/**
 * Update Rider Current Location
 */
const updateCurrentLocation = async (userId, longitude, latitude) => {
	if (typeof longitude !== "number" || typeof latitude !== "number") {
		throw new Error(
			"Invalid coordinates. Longitude and latitude must be numbers",
		);
	}

	const riderProfile = await RiderProfile.findOne({ user: userId });
	if (!riderProfile) throw new Error("Rider profile not found");

	riderProfile.currentLocation = {
		type: "Point",
		coordinates: [longitude, latitude],
	};

	await riderProfile.save();

	return {
		success: true,
		message: "Location updated successfully",
		currentLocation: riderProfile.currentLocation,
	};
};

/**
 * Update Rider Status
 */
const updateRiderStatus = async (userId, status) => {
	const validStatuses = [
		"pending",
		"deactivated",
		"available",
		"busy",
		"offline",
	];

	if (!validStatuses.includes(status)) {
		throw new Error(
			`Invalid status. Must be one of: ${validStatuses.join(", ")}`,
		);
	}

	const riderProfile = await RiderProfile.findOne({ user: userId });
	if (!riderProfile) throw new Error("Rider profile not found");

	riderProfile.status = status;
	await riderProfile.save();

	return {
		success: true,
		message: "Status updated successfully",
		status: riderProfile.status,
	};
};

/**
 * Update Bank Details
 * Bank details are stored in the Payout model, not in RiderProfile
 * This function stores them for future payout processing
 */
const updateBankDetails = async (userId, bankDetails) => {
	const { accountNumber, bankCode, accountName } = bankDetails;

	if (!accountNumber || !bankCode || !accountName) {
		throw new Error("accountNumber, bankCode, accountName required");
	}

	const riderProfile = await RiderProfile.findOne({ user: userId });
	if (!riderProfile) throw new Error("Rider profile not found");

	const retryResults = await payoutService.processPendingPayoutsForUser(
		riderProfile._id,
		"RIDER",
		{ accountNumber, bankCode, accountName },
	);

	return {
		success: true,
		message: "Bank details updated and pending payouts processed",
		retryResults,
	};
};

/**
 * Get Rider Leaderboard
 */
const getRiderLeaderboard = async () => {
	return await ratingService.getRiderLeaderboard();
};

/**
 * Deactivate Rider Account
 */
const deactivateRiderAccount = async (userId) => {
	const riderProfile = await RiderProfile.findOneAndUpdate(
		{ user: userId },
		{ status: "deactivated", isActive: false },
		{ new: true },
	);
	if (!riderProfile) throw new Error("Rider profile not found");

	logger.info(`Rider ${userId} account deactivated`);

	return {
		success: true,
		message: "Rider account deactivated successfully",
		status: riderProfile.status,
		isActive: riderProfile.isActive,
	};
};

module.exports = {
	getRiderDashboard,
	completeRiderRegistration,
	getRiderProfile,
	updateOperatingArea,
	getOperatingArea,
	updateCurrentLocation,
	updateRiderStatus,
	updateBankDetails,
	getRiderLeaderboard,
	deactivateRiderAccount,
};
