const { Customer } = require("../models");
const { getCoordsFromAddress } = require("../utils/delivery");

// Helper to format customer profile
const formatCustomerProfile = (customer) => {
	if (!customer || !customer.user) return null;

	// Merge user and customer data
	const user = customer.user.toJSON ? customer.user.toJSON() : customer.user;
	const customerData = customer.toJSON ? customer.toJSON() : customer;
	delete customerData.user; // Remove the nested user object

	// Prioritize Customer fields if they exist, otherwise use User fields
	return {
		...user,
		...customerData,
		// Ensure essential fields are present even if they are in User
		name: customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : user.name,
		phone: customer.phone || user.phone,
		address: customer.savedAddresses && customer.savedAddresses.length > 0 ? customer.savedAddresses[0].address : user.address,
		// Location preferences
		location: customer.savedAddresses && customer.savedAddresses.length > 0
			? {
				type: "Point",
				coordinates: customer.savedAddresses[0].coordinates
			}
			: user.location,
		wallet: 0 // Placeholder for wallet balance if implemented later
	};
};

const getCustomerProfile = async (req, res) => {
	const userId = req.user.id; // This is the User ID from JWT
	try {
		// Find Customer by user reference, not by ID
		const customer = await Customer.findOne({ user: userId }).populate("user");

		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		}

		const profile = formatCustomerProfile(customer);
		res.json(profile);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
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

		const profile = formatCustomerProfile(customer);

		res.json({
			success: true,
			message: "Profile updated successfully",
			customer: profile,
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
	updateCustomerProfile,
	deleteCustomerProfile,
};
