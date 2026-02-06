const { Customer } = require("../models");
const { getCoordsFromAddress } = require("../utils/delivery");

const getCustomerProfile = async (req, res) => {
	const customerId = req.user.id;
	try {
		const customer = await Customer.findById(customerId);
		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		}
		res.json(customer);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

const updateFcmToken = async (req, res) => {
	try {
		const { fcmToken } = req.body;
		const userId = req.user.id;

		if (!fcmToken) {
			return res.status(400).json({ message: "FCM token is required" });
		}

		await Customer.findByIdAndUpdate(userId, { fcmToken });
		res.status(200).json({ success: true, message: "Device token saved!" });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Failed to save token" });
	}
};

const updateCustomerProfile = async (req, res) => {
	const customerId = req.user.id;
	const { name, email, phone, location } = req.body;

	try {
		const updateData = {};

		// Add fields to update only if they are provided
		if (name) updateData.name = name;
		if (email) updateData.email = email;
		if (phone) updateData.phone = phone;

		// If location is provided, geocode it and update both address and coordinates
		if (location) {
			const geo = await getCoordsFromAddress(location);
			if (!geo) {
				return res.status(400).json({ error: "Invalid address" });
			}

			updateData.address = location;
			updateData.location = {
				type: "Point",
				coordinates: [geo.lng, geo.lat],
			};
		}

		const customer = await Customer.findByIdAndUpdate(customerId, updateData, {
			new: true,
			runValidators: true,
		});

		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		}

		res.json({
			success: true,
			message: "Profile updated successfully",
			customer,
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

const deleteCustomerProfile = async (req, res) => {
	const customerId = req.user.id;

	try {
		// Soft delete by setting accountStatus to deactivated
		const customer = await Customer.findByIdAndUpdate(
			customerId,
			{ accountStatus: "deactivated" },
			{ new: true },
		);

		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		}

		res.json({
			success: true,
			message: "Account deactivated successfully",
			customer,
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

module.exports = {
	getCustomerProfile,
	updateFcmToken,
	updateCustomerProfile,
	deleteCustomerProfile,
};
