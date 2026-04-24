const RiderProfile = require("../models/RiderProfile");
const User = require("../models/User");
const payoutService = require("./payout.service");
const ratingService = require("./rating.service");
const ledgerService = require("./ledger.service");
const logger = require("../utils/logger");
const { AVAILABLE_ZONES } = require("../utils/constants");

/**
 * Get Rider Dashboard Data
 * Aggregates Wallet info and daily earnings.
 */

const getRiderDashboard = async (riderId) => {
	// 1. Get Wallet Balances
	const balanceInfo = await ledgerService.getAccountBalance(riderId, "RIDER");
	const todayEarnings = await ledgerService.getDailyEarnings(riderId, "RIDER");

	return {
		wallet: {
			availableBalance: balanceInfo.availableBalance || 0,
			pendingBalance: balanceInfo.pendingBalance || 0,
			totalBalance: balanceInfo.totalBalance || 0,
			currency: "NGN",
		},
		stats: {
			todayEarnings: todayEarnings || 0,
		},
	};
};

/**
 * Complete Rider Registration
 */
const completeRiderRegistration = async (userId, data, files) => {
	const {
		modeOfDelivery,
		guarantorName,
		guarantorPhone,
		guarantorNin: guarantorNinNumber,
	} = data;

	const user = await User.findById(userId);
	if (!user) {
		throw new Error("User account not found");
	}

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
		if (!files.driversLicense || !files.driversLicense[0]) {
			throw new Error(
				"Driver's license document is required for Motorcycle riders",
			);
		}
		driversLicense = files.driversLicense[0].path;
	}

	if (modeOfDelivery === "Bicycle") {
		if (!files.nin || !files.nin[0]) {
			throw new Error("NIN document is required for Bicycle riders");
		}
		nin = files.nin[0].path;
	}

	riderProfile.modeOfDelivery = modeOfDelivery;
	riderProfile.guarantor = {
		name: guarantorName,
		phone: guarantorPhone,
		nin: guarantorNinNumber || guarantorNinUrl,
	};

	if (driversLicense) riderProfile.driversLicense = driversLicense;
	if (nin) riderProfile.nin = nin;

	await riderProfile.save();

	logger.info(`Rider registration completed for user ${userId}`);

	return {
		riderId: riderProfile._id,
		userId: user._id,
		name: user.name,
		phone: user.phone,
		role: user.role,
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
 */
const getRiderProfile = async (userId) => {
	const riderProfile = await RiderProfile.findOne({ user: userId })
		.populate("user", "name phone email")
		.select(
			"modeOfDelivery guarantor driversLicense nin status operatingArea isActive currentLocation earnings ratings averageRating ratingCount setupComplete",
		);

	if (!riderProfile) throw new Error("Rider profile not found");

	const bankDetails = await payoutService.getUserBankDetails(
		riderProfile._id,
		"RIDER",
	);

	// Trust the persisted setupComplete flag
	// The operating area update is the final step and sets this flag.
	const setupComplete = riderProfile.setupComplete === true;
	const missingFields = []; // No longer dynamically calculating this as it causes loops

	// Ensure isActive and status are both correct for a completed setup.
	// A rider who completed setup must always be available for dispatch.
	// This catches both the isActive=false case AND status drift (e.g. status="offline" after a crash).
	const needsHeal =
		setupComplete &&
		(!riderProfile.isActive ||
			!["available", "busy"].includes(riderProfile.status));
	if (needsHeal) {
		riderProfile.isActive = true;
		riderProfile.status = "available";
		await riderProfile.save();
		logger.info(
			`[RiderProfile] Auto-healed status to available for rider ${riderProfile._id}`,
		);
	}

	return {
		name: riderProfile.user.name,
		phone: riderProfile.user.phone,
		email: riderProfile.user.email,
		modeOfDelivery: riderProfile.modeOfDelivery,
		operatingArea: riderProfile.operatingArea || [],
		guarantor: riderProfile.guarantor || null,
		status: riderProfile.status,
		isActive: riderProfile.isActive,
		setupComplete,
		missingFields: setupComplete ? undefined : missingFields,
		earnings: riderProfile.earnings || 0,
		ratings: {
			average: riderProfile.ratings?.average || riderProfile.averageRating || 0,
			count: riderProfile.ratings?.count || riderProfile.ratingCount || 0,
		},
		documentsUploaded: {
			driversLicense: !!riderProfile.driversLicense,
			nin: !!riderProfile.nin,
			guarantorNin: !!riderProfile.guarantor?.nin,
		},

		bankDetails: bankDetails
			? {
					accountNumber: bankDetails.accountNumber,
					accountName: bankDetails.accountName,
					bankCode: bankDetails.bankCode,
					bankName: bankDetails.bankName || null,
				}
			: null,
	};
};

/**
 * Update Operating Area
 */
const updateOperatingArea = async (userId, body) => {
	const { operatingArea } = body;

	// Validate input
	if (!Array.isArray(operatingArea)) {
		throw new Error("Operating area must be an array");
	}

	if (operatingArea.length < 1 || operatingArea.length > 2) {
		throw new Error("You must select 1 or 2 delivery zones");
	}

	// Fetch rider profile
	const riderProfile = await RiderProfile.findOne({ user: userId }).populate(
		"user",
		"name phone",
	);

	if (!riderProfile) {
		throw new Error("Rider profile not found");
	}

	// Update operating area
	riderProfile.operatingArea = operatingArea;

	// Setup is complete if at least one zone is selected
	const setupComplete = operatingArea.length >= 1;

	if (setupComplete) {
		riderProfile.setupComplete = true;
	}

	if (setupComplete && !riderProfile.isActive) {
		riderProfile.isActive = true;
		riderProfile.status = "available";
	}

	await riderProfile.save();

	return {
		success: true,
		message: "Operating area updated successfully",
		data: {
			riderId: riderProfile._id,
			name: riderProfile.user.name,
			operatingArea: riderProfile.operatingArea,
			setupComplete,
		},
	};
};

/**
 * Get Operating Area
 */
const getOperatingArea = async (userId) => {
	const riderProfile = await RiderProfile.findOne({ user: userId }).select(
		"operatingArea",
	);
	if (!riderProfile) throw new Error("Rider profile not found");

	return {
		success: true,
		data: {
			operatingArea: riderProfile.operatingArea || [],
		},
	};
};

/**
 * Update Current Location
 */
const updateCurrentLocation = async (userId, longitude, latitude) => {
	if (typeof longitude !== "number" || typeof latitude !== "number") {
		throw new Error("Longitude and latitude must be numbers");
	}

	// if (longitude < -180 || longitude > 180) {
	// 	throw new Error("Longitude must be between -180 and 180");
	// }

	// if (latitude < -90 || latitude > 90) {
	// 	throw new Error("Latitude must be between -90 and 90");
	// }

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

	if (riderProfile.status === "deactivated" && status !== "deactivated") {
		throw new Error("Cannot change status of deactivated rider");
	}

	riderProfile.status = status;
	riderProfile.isActive = ["available", "busy"].includes(status);

	await riderProfile.save();

	return {
		success: true,
		message: "Status updated successfully",
		status: riderProfile.status,
		isActive: riderProfile.isActive,
	};
};

/**
 * Update Bank Details
 */
const updateBankDetails = async (userId, bankDetails) => {
	const { accountNumber, bankCode, accountName } = bankDetails;

	if (!accountNumber || !bankCode || !accountName) {
		throw new Error("accountNumber, bankCode, and accountName are required");
	}

	if (!/^\d{10}$/.test(accountNumber)) {
		throw new Error("Account number must be exactly 10 digits");
	}

	const riderProfile = await RiderProfile.findOne({ user: userId });
	if (!riderProfile) throw new Error("Rider profile not found");

	// Save the bank details onto the profile
	riderProfile.bankDetails = { accountNumber, bankCode, accountName };
	riderProfile.paystackRecipientCode = undefined; // invalidate stale recipient
	await riderProfile.save();

	// Pass userId (not riderProfile._id) — Payout.user stores the user ID
	const retryResults = await payoutService.processPendingPayoutsForUser(
		userId,
		"RIDER",
	);

	return {
		success: true,
		message: "Bank details updated and pending payouts processed",
		retryResults,
	};
};
/**
 * Leaderboard — sorted by rankingScore DESC.
 * Falls back to totalDeliveries if no scores are computed yet.
 */
const getRiderLeaderboard = async () => {
	const riders = await RiderProfile.find({ isActive: true })
		.sort({ rankingScore: -1, totalDeliveries: -1 })
		.limit(20)
		.populate("user", "name")
		.lean();

	const data = riders.map((r) => ({
		riderId: r.user?._id ?? r._id,
		name: r.user?.name ?? "—",
		totalDeliveries: r.totalDeliveries ?? 0,
		rating: r.averageRating ?? r.ratings?.average ?? 0,
		rankingScore: r.rankingScore ?? 0,
		tier: r.tier ?? "STARTER",
		acceptanceRate: r.acceptanceRate ?? 100,
	}));

	return { success: true, count: data.length, data };
};

/**
 * Change Rider Zone (once every 7 days)
 */
const changeZone = async (userId, zones) => {
	if (!Array.isArray(zones) || zones.length < 1 || zones.length > 2) {
		throw new Error("You must select 1 or 2 delivery zones");
	}

	const invalid = zones.filter((z) => !AVAILABLE_ZONES.includes(z));
	if (invalid.length > 0) {
		throw new Error(`Invalid zone(s): ${invalid.join(", ")}`);
	}

	const riderProfile = await RiderProfile.findOne({ user: userId });
	if (!riderProfile) throw new Error("Rider profile not found");

	// TODO: re-enable 7-day restriction before going to production
	// if (riderProfile.lastZoneChange) {
	// 	const daysSince =
	// 		(Date.now() - new Date(riderProfile.lastZoneChange).getTime()) /
	// 		(1000 * 60 * 60 * 24);
	// 	if (daysSince < 7) {
	// 		const daysLeft = Math.ceil(7 - daysSince);
	// 		throw new Error(
	// 			`You can only change your zone once every 7 days. Try again in ${daysLeft} day(s).`,
	// 		);
	// 	}
	// }

	riderProfile.operatingArea = zones;
	riderProfile.lastZoneChange = new Date();
	await riderProfile.save();

	return {
		success: true,
		message: "Zone updated successfully",
		data: {
			operatingArea: riderProfile.operatingArea,
			lastZoneChange: riderProfile.lastZoneChange,
		},
	};
};

/**
 * Deactivate Account
 */
const deactivateRiderAccount = async (userId) => {
	const riderProfile = await RiderProfile.findOneAndUpdate(
		{ user: userId },
		{ status: "deactivated", isActive: false },
		{ new: true },
	);

	if (!riderProfile) throw new Error("Rider profile not found");

	return {
		success: true,
		message: "Rider account deactivated successfully",
		status: riderProfile.status,
		isActive: riderProfile.isActive,
	};
};

// Work out what tier a rider belongs to based on their score.
// Thresholds are deliberately generous for launch so new riders aren't stuck at STARTER long.
const _tierForScore = (score) => {
	if (score >= 80) return "ELITE";
	if (score >= 40) return "PRO";
	if (score >= 15) return "ACTIVE";
	return "STARTER";
};

// Recomputes and saves a rider's ranking score + tier.
// Formula: (totalDeliveries * 0.4) + (averageRating * 0.4) + (acceptanceRate * 0.2)
// Call this after: order accepted, order delivered, rating received.
const updateRiderRankingScore = async (riderId) => {
	try {
		const rider = await RiderProfile.findById(riderId).select(
			"totalDeliveries averageRating acceptanceRate",
		);
		if (!rider) return;

		const score =
			rider.totalDeliveries * 0.4 +
			(rider.averageRating || 0) * 0.4 +
			(rider.acceptanceRate ?? 100) * 0.2;

		const tier = _tierForScore(score);
		await RiderProfile.findByIdAndUpdate(riderId, {
			rankingScore: score,
			tier,
		});
	} catch (err) {
		logger.error(
			`updateRiderRankingScore failed riderId=${riderId}: ${err.message}`,
		);
	}
};

module.exports = {
	getRiderDashboard,
	completeRiderRegistration,
	getRiderProfile,
	updateOperatingArea,
	getOperatingArea,
	changeZone,
	updateCurrentLocation,
	updateRiderStatus,
	updateBankDetails,
	getRiderLeaderboard,
	deactivateRiderAccount,
	updateRiderRankingScore,
};
