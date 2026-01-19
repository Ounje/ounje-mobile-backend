const payoutService = require("../services/payout.service");

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
	pass;
};

module.exports = { registerRider, updateBankDetails };
