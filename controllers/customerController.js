const { Customer, User } = require("../models");
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
		email: user.email ?? null,
		name: customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : user.name,
		phone: customer.phone || user.phone,
		address: customer.savedAddresses && customer.savedAddresses.length > 0 ? customer.savedAddresses[0].address : user.address,
		// Location preferences
		totalOrders: customer.orderCount || 0,
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
		const customer = await Customer.findOne({ user: userId }).populate("user").populate("orderCount");

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
	const { firstName, lastName, phone, location, email } = req.body;

	try {
		const updateData = {};
		const userUpdate = {};

		// Add fields to update only if they are provided
		if (firstName) updateData.firstName = firstName;
		if (lastName) updateData.lastName = lastName;
		if (phone) updateData.phone = phone;
		if (email !== undefined) userUpdate.email = email;

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

		const [customer] = await Promise.all([
			Customer.findOneAndUpdate(
				{ user: userId },
				updateData,
				{ new: true, runValidators: true }
			).populate("user", "email role name phone address location"),
			Object.keys(userUpdate).length > 0
				? User.findByIdAndUpdate(userId, { $set: userUpdate }, { new: true })
				: Promise.resolve(null),
		]);

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

const updateCustomerProfileImage = async (req, res) => {
	try {
		const userId = req.user.id;

		if (!req.file) {
			return res.status(400).json({
				success: false,
				message: "Profile image file is required",
			});
		}

		const profilePic = req.file.path;

		await User.findByIdAndUpdate(userId, { img: profilePic });

		return res.status(200).json({ success: true, profilePic });
	} catch (error) {
		console.error(`Update Customer Profile Image Error: ${error.message}`);
		return res.status(500).json({
			success: false,
			message: error.message || "Error updating profile image",
		});
	}
};

/**
 * GET /api/customers/wallet
 * Returns the customer's O-Credit balance and transaction history.
 * Customers currently earn credit only via refunds; the default is zero.
 */
const getCustomerWallet = async (req, res) => {
	try {
		const userId = req.user.id;
		const customer = await Customer.findOne({ user: userId }).select("_id").lean();

		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		}

		const ledgerService = require("../services/ledger.service");

		// Customers may accumulate credit (e.g., refunds). If no account exists yet, return zeros.
		const balanceInfo = await ledgerService.getAccountBalance(customer._id, "CUSTOMER");
		const { transactions = [] } = await ledgerService.getTransactionHistory(
			customer._id,
			"CUSTOMER",
			20,
			0,
		);

		return res.json({
			balance: balanceInfo.availableBalance ?? 0,
			pendingBalance: balanceInfo.pendingBalance ?? 0,
			// ── UPDATED: Provide the actual bank details ──
            bankDetails: customer.titanAccount || null,
			transactions,
		});
	} catch (err) {
		console.error("getCustomerWallet error:", err);
		res.status(500).json({ error: err.message });
	}
};

module.exports = {
	getCustomerProfile,
	updateCustomerProfile,
	deleteCustomerProfile,
	updateCustomerProfileImage,
	getCustomerWallet,
};
