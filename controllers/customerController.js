const { Customer, User, PendingProfileChange } = require("../models");
const EmailService = require("../services/email/EmailService");
const { getCoordsFromAddress } = require("../utils/delivery");
const { requestSmsOtp, verifySmsOtp } = require("../utils/kudiSmsHelper");
const ledgerService = require("../services/ledger.service");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();

const formatCustomerProfile = (customer, walletBalance = 0) => {
	if (!customer || !customer.user) return null;

	const user = customer.user.toJSON ? customer.user.toJSON() : customer.user;
	const customerData = customer.toJSON ? customer.toJSON() : customer;
	delete customerData.user;

	return {
		...user,
		...customerData,
		email: user.email ?? null,
		name:
			customer.firstName && customer.lastName
				? `${customer.firstName} ${customer.lastName}`
				: user.name,
		phone: Number(customer.phone || user.phone) || null,
		address:
			customer.savedAddresses && customer.savedAddresses.length > 0
				? customer.savedAddresses[0].address
				: user.address,
		totalOrders: customer.orderCount || 0,
		location:
			customer.savedAddresses && customer.savedAddresses.length > 0
				? {
						type: "Point",
						coordinates: customer.savedAddresses[0].coordinates,
					}
				: user.location,
		wallet: walletBalance,
	};
};

const getCustomerProfile = asyncHandler(async (req, res) => {
	const userId = req.user.id;

	const customer = await Customer.findOne({ user: userId })
		.populate("user")
		.populate("orderCount");

	if (!customer) {
		return res.status(404).json({ error: "Customer not found" });
	}

	// Pull live wallet balance for the profile response
	let walletBalance = 0;
	try {
		const balance = await ledgerService.getAccountBalance(
			customer._id,
			"CUSTOMER",
		);
		walletBalance = balance.availableBalance ?? 0;
	} catch (_) {
		// non-fatal — profile still returns without balance
	}

	res.json(formatCustomerProfile(customer, walletBalance));
});

const requestProfileChange = async (req, res) => {
	const userId = req.user.id;
	const { email, phone } = req.body;

	try {
		if (email !== undefined && phone !== undefined) {
			return res
				.status(400)
				.json({ error: "Change email and phone separately" });
		}

		if (email === undefined && phone === undefined) {
			return res.status(400).json({ error: "No sensitive fields to verify" });
		}

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ error: "User not found" });

		const customer = await Customer.findOne({ user: userId });
		if (!customer) return res.status(404).json({ error: "Customer not found" });

		const existingPhone = customer.phone || user.phone;
		const existingEmail = user.email;

		if (email !== undefined) {
			const emailTaken = await User.findOne({ email, _id: { $ne: userId } });
			if (emailTaken) {
				return res.status(400).json({ error: "Email is already in use" });
			}

			if (!existingPhone) {
				return res
					.status(400)
					.json({ error: "No phone number on record to verify with" });
			}

			await requestSmsOtp(existingPhone);

			return res.json({
				success: true,
				message: "OTP sent to your registered phone number",
			});
		}

		if (phone !== undefined) {
			const phoneTaken = await User.findOne({
				phone: Number(phone),
				_id: { $ne: userId },
			});
			if (phoneTaken) {
				return res
					.status(400)
					.json({ error: "Phone number is already in use" });
			}

			if (!existingEmail) {
				return res
					.status(400)
					.json({ error: "No email on record to verify with" });
			}

			const otp = generateOtp();
			const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

			await PendingProfileChange.findOneAndUpdate(
				{ user: userId },
				{
					user: userId,
					otp,
					otpExpiresAt,
					pendingPhone: Number(phone),
					verified: false,
				},
				{ upsert: true, new: true },
			);

			await EmailService.sendProfileChangeConfirmationEmailOtp(
				existingEmail,
				otp,
			);

			return res.json({
				success: true,
				message: "OTP sent to your registered email",
			});
		}
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

const verifyProfileChangeOtp = async (req, res) => {
	const userId = req.user.id;
	const { otp, email, phone } = req.body;

	try {
		if (email !== undefined && phone !== undefined) {
			return res
				.status(400)
				.json({ error: "Verify email and phone changes separately" });
		}
		if (email === undefined && phone === undefined) {
			return res
				.status(400)
				.json({ error: "Specify which field you are verifying" });
		}

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ error: "User not found" });

		const customer = await Customer.findOne({ user: userId });
		if (!customer) return res.status(404).json({ error: "Customer not found" });

		if (email !== undefined) {
			const existingPhone = customer.phone || user.phone;
			if (!existingPhone) {
				return res.status(400).json({ error: "No phone number on record" });
			}

			const isValid = await verifySmsOtp(existingPhone, otp);
			if (!isValid) {
				return res.status(400).json({ error: "Invalid or expired OTP" });
			}

			await PendingProfileChange.findOneAndUpdate(
				{ user: userId },
				{
					user: userId,
					otp: "sms-verified",
					otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
					pendingEmail: email,
					pendingPhone: undefined,
					verified: true,
				},
				{ upsert: true, new: true },
			);
		}

		if (phone !== undefined) {
			const pending = await PendingProfileChange.findOne({
				user: userId,
				verified: false,
			});

			if (!pending)
				return res
					.status(400)
					.json({ error: "No pending change request found" });
			if (pending.otpExpiresAt < new Date())
				return res.status(400).json({ error: "OTP has expired" });
			if (pending.otp !== otp)
				return res.status(400).json({ error: "Invalid OTP" });

			pending.verified = true;
			await pending.save();
		}

		res.json({
			success: true,
			message: "OTP verified. You may now update your profile.",
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
};

const updateCustomerProfile = async (req, res) => {
	const userId = req.user.id;
	const { firstName, lastName, phone, location, email } = req.body;

	try {
		const isSensitiveChange = email !== undefined || phone !== undefined;

		if (isSensitiveChange) {
			const user = await User.findById(userId);
			const customer = await Customer.findOne({ user: userId });

			const hasExistingEmail = !!user?.email;
			const hasExistingPhone = !!(customer?.phone || user?.phone);

			const changingExistingEmail = email !== undefined && hasExistingEmail;
			const changingExistingPhone = phone !== undefined && hasExistingPhone;

			if (changingExistingEmail || changingExistingPhone) {
				const pending = await PendingProfileChange.findOne({
					user: userId,
					verified: true,
				});

				if (!pending) {
					return res.status(403).json({
						error: "Email or phone changes require OTP verification first.",
					});
				}

				if (email !== undefined && pending.pendingEmail !== email) {
					return res
						.status(403)
						.json({ error: "Email does not match verified request" });
				}
				if (
					phone !== undefined &&
					Number(pending.pendingPhone) !== Number(phone)
				) {
					return res
						.status(403)
						.json({ error: "Phone does not match verified request" });
				}

				await PendingProfileChange.deleteOne({ user: userId });
			}
		}

		const updateData = {};
		const userUpdate = {};

		if (firstName) updateData.firstName = firstName;
		if (lastName) updateData.lastName = lastName;
		if (phone) userUpdate.phone = Number(phone);
		if (email !== undefined) userUpdate.email = email;

		if (location) {
			const geo = await getCoordsFromAddress(location);
			if (!geo) {
				return res.status(400).json({ error: "Invalid address" });
			}

			const existingProfile = await Customer.findOne({ user: userId });
			if (existingProfile) {
				const newAddress = {
					label: "Home",
					address: location,
					coordinates: [geo.lng, geo.lat],
				};
				if (existingProfile.savedAddresses?.length > 0) {
					existingProfile.savedAddresses[0] = newAddress;
				} else {
					existingProfile.savedAddresses = [newAddress];
				}
				updateData.savedAddresses = existingProfile.savedAddresses;
			}
		}

		const [customer] = await Promise.all([
			Customer.findOneAndUpdate({ user: userId }, updateData, {
				new: true,
				runValidators: true,
			}).populate("user", "email role name phone address location"),
			Object.keys(userUpdate).length > 0
				? User.findByIdAndUpdate(userId, { $set: userUpdate }, { new: true })
				: Promise.resolve(null),
		]);

		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		}

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

const updateCustomerProfileImage = async (req, res) => {
	try {
		const userId = req.user.id;

		if (!req.file) {
			return res
				.status(400)
				.json({ success: false, message: "Profile image file is required" });
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
 * Returns wallet balance + titanAccount + last 20 transactions
 */
const getCustomerWallet = asyncHandler(async (req, res) => {
	const userId = req.user.id;

	const customer = await Customer.findOne({ user: userId })
		.select("_id titanAccount")
		.lean();

	if (!customer) throw new AppError("Customer not found", 404);

	let balanceInfo = { availableBalance: 0, pendingBalance: 0, totalBalance: 0 };
	let transactions = [];

	try {
		balanceInfo = await ledgerService.getAccountBalance(
			customer._id,
			"CUSTOMER",
		);
	} catch (_) {}

	try {
		const result = await ledgerService.getTransactionHistory(
			customer._id,
			"CUSTOMER",
			20,
			0,
		);
		transactions = result.transactions ?? [];
	} catch (_) {}

	return res.json({
		success: true,
		balance: balanceInfo.availableBalance ?? 0,
		pendingBalance: balanceInfo.pendingBalance ?? 0,
		totalBalance: balanceInfo.totalBalance ?? 0,
		balanceFormatted: `₦${(balanceInfo.availableBalance ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
		bankDetails: customer.titanAccount?.accountNumber
			? customer.titanAccount
			: {
					status: "processing",
					message: "Your account is being prepared. Please check back shortly.",
				},
		transactions,
	});
});

module.exports = {
	getCustomerProfile,
	requestProfileChange,
	verifyProfileChangeOtp,
	updateCustomerProfile,
	deleteCustomerProfile,
	updateCustomerProfileImage,
	getCustomerWallet,
};
