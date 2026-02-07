const { Customer } = require("../models");
const { getCoordsFromAddress } = require("../utils/delivery");

const getCustomerProfile = async (req, res) => {
	const userId = req.user.id; // This is the User ID from JWT
	try {
		// Find Customer by user reference, not by ID
		const customer = await Customer.findOne({ user: userId }).populate("user", "email role isVerified");
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

		await Customer.findOneAndUpdate({ user: userId }, { fcmToken });
		res.status(200).json({ success: true, message: "Device token saved!" });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Failed to save token" });
	}
};

const updateCustomerProfile = async (req, res) => {
	const userId = req.user.id;
	const { firstName, lastName, phone, location } = req.body;

	try {
		const updateData = {};

		// Add fields to update only if they are provided
		if (firstName) updateData.firstName = firstName;
		if (lastName) updateData.lastName = lastName;
		if (phone) updateData.phone = phone;

		// If location is provided, add it to savedAddresses
		if (location) {
			const geo = await getCoordsFromAddress(location);
			if (!geo) {
				return res.status(400).json({ error: "Invalid address" });
			}

			// Get existing profile to update addresses
			const existingProfile = await Customer.findOne({ user: userId });
			if (existingProfile) {
				const newAddress = {
					label: "Home",
					address: location,
					coordinates: [geo.lng, geo.lat]
				};
				// Replace or add the first address
				if (existingProfile.savedAddresses && existingProfile.savedAddresses.length > 0) {
					existingProfile.savedAddresses[0] = newAddress;
				} else {
					existingProfile.savedAddresses = [newAddress];
				}
				updateData.savedAddresses = existingProfile.savedAddresses;
			}
		}

		const customer = await Customer.findOneAndUpdate(
			{ user: userId },
			updateData,
			{
				new: true,
				runValidators: true,
			}
		).populate("user", "email role");

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
	const userId = req.user.id;

	try {
		// Soft delete by setting isActive to false on the profile
		const customer = await Customer.findOneAndUpdate(
			{ user: userId },
			{ isActive: false },
			{ new: true }
		).populate("user", "email");

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
