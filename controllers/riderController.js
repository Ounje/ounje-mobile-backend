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
		const { modeOfDelivery, guarantorName, guarantorPhone, guarantorNin } =
			req.body;

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

		if (!modeOfDelivery || !guarantorName || !guarantorPhone || !guarantorNin) {
			return res.status(400).json({
				success: false,
				message:
					"All fields are required: modeOfDelivery, guarantorName, guarantorPhone, guarantorNin",
			});
		}

		if (!["Bicycle", "Motorcycle"].includes(modeOfDelivery)) {
			return res.status(400).json({
				success: false,
				message: "Invalid mode of delivery. Must be 'Bicycle' or 'Motorcycle'",
			});
		}

		let driversLicense = null;
		let nin = null;

		if (modeOfDelivery === "Motorcycle") {
			if (!req.file || !req.file.path) {
				return res.status(400).json({
					success: false,
					message: "Drivers license document is required for Motorcycle riders",
				});
			}
			driversLicense = req.file.path;
		}

		if (modeOfDelivery === "Bicycle") {
			if (!req.file || !req.file.path) {
				return res.status(400).json({
					success: false,
					message: "NIN document is required for Bicycle riders",
				});
			}
			nin = req.file.path;
		}

		const guarantor = {
			guarantorName,
			guarantorPhone: Number(guarantorPhone),
			guarantorNin,
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
				},
				documentsUploaded: {
					driversLicense: !!driversLicense,
					nin: !!nin,
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

module.exports = {
	completeRiderRegistration,
	registerRider,
	updateBankDetails,
	riderLeaderBoard,
};
