const payoutService = require("../services/payout.service");
const ratingService = require("../services/rating.service");
const Rider = require("../models/Rider");

const registerRider = async (req, res) => {
	const { name, selectedZones } = req.body; // e.g., ["Ikeja", "Yaba"]

	// Validation: Check if they picked more than 2
	if (selectedZones.length > 2) {
		return res.status(400).json({
			success: false,
			message: "You can only select a maximum of 2 delivery zones.",
		});
	}

	// Save to database (MongoDB/PostgreSQL)
	// await Rider.create({ name, zones: selectedZones });

	res.status(201).json({
		message: "Rider registered successfully!" + selectedZones.join(", "),
	});
};

const updateBankDetails = async (req, res) => {
	try {
		const riderId = req.user.id;
		const { accountNumber, bankCode, accountName } = req.body;

		if (!accountNumber || !bankCode || !accountName) {
			return res
				.status(400)
				.json({ error: "accountNumber, bankCode, accountName required" });
		}

		const RiderModel = require("../models/Rider");
		const rider = await RiderModel.findByIdAndUpdate(
			riderId,
			{ bankDetails: { accountNumber, bankCode, accountName } },
			{ new: true },
		);

		// Trigger retry of pending payouts
		const retryResults = await payoutService.processPendingPayoutsForUser(
			rider._id,
			"RIDER",
		);

		res.json({ rider, retryResults });
	} catch (err) {
		console.error("Update bank details failed:", err.message);
		res.status(500).json({ error: err.message });
	}
};

const riderLeaderBoard = async (req, res) => {
	try {
		const result = await ratingService.getRiderLeaderboard();
		res.status(200).json(result);
	} catch (err) {
		console.error("Rider Leaderboard Error:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

const completeRiderRegistration = async (req, res) => {
	try {
		const { modeOfDelivery, guarantorName, guarantorPhone } = req.body;
		const riderId = req.user.id;

		const rider = await Rider.findById(riderId);
		if (!rider) {
			return res.status(404).json({
				success: false,
				message: "Rider not found",
			});
		}

		if (rider.Guarantor && rider.Guarantor.length > 0) {
			return res.status(400).json({
				success: false,
				message: "Registration already completed. Guarantor already exists.",
			});
		}

		if (!modeOfDelivery || !guarantorName || !guarantorPhone) {
			return res.status(400).json({
				success: false,
				message:
					"All fields are required: modeOfDelivery, guarantorName, guarantorPhone",
			});
		}

		if (!["Bicycle", "Motorcycle"].includes(modeOfDelivery)) {
			return res.status(400).json({
				success: false,
				message: "Invalid mode of delivery. Must be 'Bicycle' or 'Motorcycle'",
			});
		}

		// Check for guarantor NIN file - REQUIRED for all riders
		if (!req.files || !req.files.guarantorNin || !req.files.guarantorNin[0]) {
			return res.status(400).json({
				success: false,
				message: "Guarantor NIN document is required",
			});
		}

		const guarantorNinUrl = req.files.guarantorNin[0].path;

		let driversLicense = null;
		let nin = null;

		if (modeOfDelivery === "Motorcycle") {
			// Motorcycle riders need driver's license
			if (
				!req.files ||
				!req.files.driversLicense ||
				!req.files.driversLicense[0]
			) {
				return res.status(400).json({
					success: false,
					message: "Drivers license document is required for Motorcycle riders",
				});
			}
			driversLicense = req.files.driversLicense[0].path;
		}

		if (modeOfDelivery === "Bicycle") {
			// Bicycle riders need NIN
			if (!req.files || !req.files.nin || !req.files.nin[0]) {
				return res.status(400).json({
					success: false,
					message: "NIN document is required for Bicycle riders",
				});
			}
			nin = req.files.nin[0].path;
		}

		const guarantor = {
			guarantorName,
			guarantorPhone: Number(guarantorPhone),
			guarantorNin: guarantorNinUrl,
		};

		rider.modeOfDelivery = modeOfDelivery;
		rider.Guarantor = [guarantor];

		if (driversLicense) {
			rider.driversLicense = driversLicense;
		}

		if (nin) {
			rider.nin = nin;
		}

		await rider.save();

		return res.status(200).json({
			success: true,
			message: "Rider registration completed successfully",
			data: {
				riderId: rider._id,
				name: rider.name,
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
			},
		});
	} catch (err) {
		console.error("Complete Rider Registration Error:", err);
		return res.status(500).json({
			success: false,
			message: "An error occurred while completing registration",
			error: err.message,
		});
	}
};
const getRiderProfile = async (req, res) => {
	try {
		const riderId = req.user.id;
		const rider = await Rider.findById(riderId).select(
			"name phone modeOfDelivery Guarantor bankDetails driversLicense nin operatingArea",
		);

		if (!rider) {
			return res.status(404).json({
				success: false,
				message: "Rider not found",
			});
		}

		// Determine if setup is complete based on backend data
		let setupComplete = false;
		let missingFields = [];

		// Check basic fields
		if (!rider.modeOfDelivery) {
			missingFields.push("modeOfDelivery");
		}

		if (!rider.Guarantor || rider.Guarantor.length === 0) {
			missingFields.push("Guarantor information");
		} else {
			// Check if guarantor has all required fields
			const guarantor = rider.Guarantor[0];
			if (!guarantor.guarantorName) {
				missingFields.push("guarantorName");
			}
			if (!guarantor.guarantorPhone) {
				missingFields.push("guarantorPhone");
			}
			if (!guarantor.guarantorNin) {
				missingFields.push("guarantorNin document");
			}
		}

		// Check mode-specific documents
		if (rider.modeOfDelivery === "Motorcycle") {
			if (!rider.driversLicense) {
				missingFields.push("driversLicense document");
			}
		} else if (rider.modeOfDelivery === "Bicycle") {
			if (!rider.nin) {
				missingFields.push("nin document");
			}
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

		// Setup is complete only if no fields are missing
		setupComplete = missingFields.length === 0;

		// Prepare response data
		const responseData = {
			name: rider.name,
			phone: rider.phone,
			modeOfDelivery: rider.modeOfDelivery,
			operatingArea: rider.operatingArea || [],
			Guarantor: rider.Guarantor,
			bankDetails: rider.bankDetails,
			setupComplete,
		};

		// Include missing fields info if setup is not complete
		if (!setupComplete) {
			responseData.missingFields = missingFields;
		}

		// Include document upload status
		responseData.documentsUploaded = {
			driversLicense: !!rider.driversLicense,
			nin: !!rider.nin,
			guarantorNin:
				rider.Guarantor && rider.Guarantor.length > 0
					? !!rider.Guarantor[0].guarantorNin
					: false,
		};

		res.json({
			success: true,
			data: responseData,
		});
	} catch (err) {
		console.error("Get Rider Profile Error:", err);
		res.status(500).json({
			success: false,
			message: "An error occurred while fetching rider profile",
			error: err.message,
		});
	}
};
module.exports = {
	completeRiderRegistration,
	registerRider,
	updateBankDetails,
	riderLeaderBoard,
	getRiderProfile,
};
