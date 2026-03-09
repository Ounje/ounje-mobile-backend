const { Customer, User } = require("../models");
const { getCoordsFromAddress } = require("../utils/delivery");

const formatCustomerProfile = (customer) => {
	if (!customer || !customer.user) return null;

	const user = customer.user.toJSON ? customer.user.toJSON() : customer.user;
	const customerData = customer.toJSON ? customer.toJSON() : customer;
	delete customerData.user;

	return {
		...user,
		...customerData,
		name: customer.name || user.name,
		phone: customer.phone || user.phone,
		address:
			customer.savedAddresses?.length > 0
				? customer.savedAddresses[0].address
				: user.address,
		location:
			customer.savedAddresses?.length > 0
				? {
						type: "Point",
						coordinates: customer.savedAddresses[0].coordinates,
					}
				: user.location,
		wallet: 0,
	};
};

const getCustomerProfile = async (req, res) => {
	const userId = req.user.id;
	try {
		const customer = await Customer.findOne({ user: userId }).populate("user");

		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		}

		res.json(formatCustomerProfile(customer));
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
	const { name, phone, location } = req.body;
	try {
		const customerUpdate = {};
		const userUpdate = {};

		if (name !== undefined) {
			customerUpdate.name = name;
			userUpdate.name = name;
		}

		if (phone !== undefined) {
			customerUpdate.phone = Number(phone); // Number on both schemas
			userUpdate.phone = Number(phone);
		}

		if (location) {
			const geo = await getCoordsFromAddress(location);
			if (!geo) return res.status(400).json({ error: "Invalid address" });

			const newAddress = {
				label: "Home",
				address: location,
				coordinates: [geo.lng, geo.lat],
			};

			const existing = await Customer.findOne({ user: userId });
			if (!existing)
				return res.status(404).json({ error: "Customer not found" });

			if (existing.savedAddresses?.length > 0) {
				customerUpdate["savedAddresses.0"] = newAddress;
			} else {
				customerUpdate.savedAddresses = [newAddress];
			}

			userUpdate.address = location;
			userUpdate.location = {
				type: "Point",
				coordinates: [geo.lng, geo.lat],
			};
		}

		// Bail early if nothing to update
		if (
			Object.keys(customerUpdate).length === 0 &&
			Object.keys(userUpdate).length === 0
		) {
			return res.status(400).json({ error: "No fields provided to update" });
		}

		const [customer] = await Promise.all([
			Customer.findOneAndUpdate(
				{ user: userId },
				{ $set: customerUpdate },
				{ new: true, runValidators: true },
			).populate("user", "email role name phone address location"),

			Object.keys(userUpdate).length > 0
				? User.findByIdAndUpdate(
						userId,
						{ $set: userUpdate },
						{ new: true, runValidators: true },
					)
				: Promise.resolve(null),
		]);

		if (!customer) return res.status(404).json({ error: "Customer not found" });

		res.json({
			success: true,
			message: "Profile updated successfully",
			customer: formatCustomerProfile(customer),
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

const deleteCustomerProfile = async (req, res) => {
	const userId = req.user.id;
	try {
		const customer = await Customer.findOneAndUpdate(
			{ user: userId },
			{ isActive: false },
			{ new: true },
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
