const { Rider } = require("../models");
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
 * Register a new Rider
 * Handles simple registration logic (zones selection, etc.)
 * deprecated - actual registration handled by auth service
 */
const registerRider = async (data) => {
	const { name, selectedZones } = data;

	if (selectedZones && selectedZones.length > 2) {
		throw new Error("You can only select a maximum of 2 delivery zones.");
	}

	// Logic to actually create/update rider would go here if not already handled by auth
	// For now returning success message as per original controller
	return {
		message:
			"Rider registered successfully! " +
			(selectedZones ? selectedZones.join(", ") : ""),
	};
};

/**
 * Update/Set Operating Area for Rider
 * Allows riders to select their operating zones (max 2)
 */

const updateOperatingArea = async (riderId, body) => {
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

	const rider = await Rider.findByIdAndUpdate(
		riderId,
		{ operatingArea },
		{ new: true },
	).select("name phone operatingArea");

	if (!rider) {
		throw new Error("Rider not found");
	}

	logger.info(
		`Rider ${riderId} updated operating area: ${operatingArea.join(", ")}`,
	);

	return {
		success: true,
		message: "Operating area updated successfully",
		data: {
			riderId: rider._id,
			name: rider.name,
			operatingArea: rider.operatingArea,
		},
	};
};

/**
 * Get Rider Operating Area
 * Fetches the current operating zones for a rider
 */
const getOperatingArea = async (riderId) => {
	const rider = await Rider.findById(riderId).select("operatingArea");

	if (!rider) {
		throw new Error("Rider not found");
	}

	return {
		success: true,
		data: {
			operatingArea: rider.operatingArea || [],
		},
	};
};

/**
 * Update Bank Details
 * Updates bank info and retries any pending payouts.
 */
const updateBankDetails = async (riderId, bankDetails) => {
	const { accountNumber, bankCode, accountName } = bankDetails;

	if (!accountNumber || !bankCode || !accountName) {
		throw new Error("accountNumber, bankCode, accountName required");
	}

	const rider = await Rider.findByIdAndUpdate(
		riderId,
		{ bankDetails: { accountNumber, bankCode, accountName } },
		{ new: true },
	);

	if (!rider) throw new Error("Rider not found");

	// Trigger retry of pending payouts
	const retryResults = await payoutService.processPendingPayoutsForUser(
		rider._id,
		"RIDER",
	);

	return { rider, retryResults };
};

/**
 * Complete Rider Registration
 * Handles document uploads and profile completion.
 */
const completeRiderRegistration = async (riderId, data, files) => {
	const { modeOfDelivery, guarantorName, guarantorPhone } = data;

	const rider = await Rider.findById(riderId);
	if (!rider) throw new Error("Rider not found");

	if (rider.Guarantor && rider.Guarantor.length > 0) {
		throw new Error(
			"Registration already completed. Guarantor already exists.",
		);
	}

	if (!modeOfDelivery || !guarantorName || !guarantorPhone) {
		throw new Error(
			"All fields are required: modeOfDelivery, guarantorName, guarantorPhone",
		);
	}

	if (!["Bicycle", "Motorcycle"].includes(modeOfDelivery)) {
		throw new Error(
			"Invalid mode of delivery. Must be 'Bicycle' or 'Motorcycle'",
		);
	}

	// --- File Validation ---
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

	// --- Save Data ---
	const guarantor = {
		guarantorName,
		guarantorPhone,
		guarantorNin: guarantorNinUrl,
	};

	rider.modeOfDelivery = modeOfDelivery;
	rider.Guarantor = [guarantor];
	rider.status = "active"; // Set status to active after successful registration

	if (driversLicense) rider.driversLicense = driversLicense;
	if (nin) rider.nin = nin;

	await rider.save();

	return {
		riderId: rider._id,
		name: rider.name,
		status: rider.status,
		modeOfDelivery: rider.modeOfDelivery,
		guarantor: {
			guarantorName: guarantor.guarantorName,
			guarantorPhone: guarantor.guarantorPhone,
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
 * NOTE: Operating area is now handled separately
 */
const getRiderProfile = async (riderId) => {
	const rider = await Rider.findById(riderId).select(
		"name phone modeOfDelivery Guarantor bankDetails driversLicense nin operatingArea",
	);

	if (!rider) throw new Error("Rider not found");

	let setupComplete = false;
	let missingFields = [];

	// Check basic fields
	if (!rider.modeOfDelivery) missingFields.push("modeOfDelivery");

	if (!rider.Guarantor || rider.Guarantor.length === 0) {
		missingFields.push("Guarantor information");
	} else {
		const guarantor = rider.Guarantor[0];
		if (!guarantor.guarantorName) missingFields.push("guarantorName");
		if (!guarantor.guarantorPhone) missingFields.push("guarantorPhone");
		if (!guarantor.guarantorNin) missingFields.push("guarantorNin document");
	}

	// Check mode-specific documents
	if (rider.modeOfDelivery === "Motorcycle") {
		if (!rider.driversLicense) missingFields.push("driversLicense document");
	} else if (rider.modeOfDelivery === "Bicycle") {
		if (!rider.nin) missingFields.push("nin document");
	}

	// Check operating area
	if (!rider.operatingArea || rider.operatingArea.length === 0) {
		missingFields.push("operatingArea");
	}

	// Check bank details
	if (
		!rider.bankDetails ||
		!rider.bankDetails.accountNumber ||
		!rider.bankDetails.bankCode ||
		!rider.bankDetails.accountName
	) {
		missingFields.push("bankDetails");
	}

	setupComplete = missingFields.length === 0;

	const responseData = {
		name: rider.name,
		phone: rider.phone,
		modeOfDelivery: rider.modeOfDelivery,
		operatingArea: rider.operatingArea || [],
		Guarantor: rider.Guarantor,
		bankDetails: rider.bankDetails,
		setupComplete,
	};

	if (!setupComplete) {
		responseData.missingFields = missingFields;
	}

	responseData.documentsUploaded = {
		driversLicense: !!rider.driversLicense,
		nin: !!rider.nin,
		guarantorNin:
			rider.Guarantor && rider.Guarantor.length > 0
				? !!rider.Guarantor[0].guarantorNin
				: false,
	};

	return responseData;
};

/**
 * Get Rider Leaderboard
 */
const getRiderLeaderboard = async () => {
	return await ratingService.getRiderLeaderboard();
};

const deactivateRider = async (riderId) => {
	const rider = await Rider.findByIdAndUpdate(
		riderId,
		{ status: "deactivated" },
		{ new: true },
	);
	if (!rider) throw new Error("Rider not found");
	return rider;
};
module.exports = {
	getRiderDashboard,
	deactivateRider,
	registerRider,
	updateOperatingArea,
	getOperatingArea,
	updateBankDetails,
	completeRiderRegistration,
	getRiderProfile,
	getRiderLeaderboard,
};
