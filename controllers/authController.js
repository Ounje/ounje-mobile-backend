const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {
	User,
	Customer,
	VendorProfile,
	RiderProfile,
	OtpVerification,
	RefreshToken,
} = require("../models");
const emailService = require("../services/email/EmailService");
const {
	generateAccessToken,
	generateRefreshToken,
} = require("../utils/generateToken");
const { requestSmsOtp, verifySmsOtp } = require("../utils/kudiSmsHelper");
const { getCoordsFromAddress } = require("../utils/delivery");
const { syncUserToKitchen } = require("../utils/kitchenSync");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");

const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();
const normalizePhone = require("../utils/phoneNormalizer");
const { checkActiveUser } = require("../middleware/auth");
const { validateUserStatus } = require("../utils/accountValidator");
const { provisionCustomerDVA } = require("../services/dva.service");

const register = asyncHandler(async (req, res) => {
	const { name, role, phone, location, email, otpSession, fcmToken } = req.body;

	if (!otpSession) throw new AppError("OTP session token is required", 400);

	let decoded;
	try {
		decoded = jwt.verify(otpSession, process.env.JWT_SECRET);
	} catch {
		throw new AppError("Invalid or expired OTP session", 400);
	}

	let finalPhone = phone || null;
	let finalEmail = email || null;

	if (role === "vendor" || role === "rider") {
		if (!decoded.phone)
			throw new AppError("Phone OTP required for vendor/rider", 400);
		finalPhone = decoded.phone;
	} else if (role === "customer") {
		// Customer can use either phone or email
		finalPhone = decoded.phone || phone;
		finalEmail = decoded.email || email;
	} else {
		throw new AppError("Invalid role", 400);
	}

	if (!name) throw new AppError("Name is required", 400);

	if (role === "vendor" || role === "rider") {
		if (!finalPhone)
			throw new AppError("Phone number required for vendor/rider", 400);
	} else if (role === "customer") {
		if (!finalEmail && !finalPhone)
			throw new AppError("Email or phone required for customer", 400);
	}

	if (finalEmail) {
		const existingEmail = await User.findOne({ email: finalEmail });
		if (existingEmail) throw new AppError("Email already exists", 400);
	}

	if (finalPhone) {
		const existingPhone = await User.findOne({ phone: finalPhone });
		if (existingPhone) throw new AppError("Phone already exists", 400);
	}

	const geo = await getCoordsFromAddress(location);
	if (!geo) throw new AppError("Invalid address", 400);

	const coordinates = { type: "Point", coordinates: [geo.lng, geo.lat] };

	// Create User document first
	const user = new User({
		name,
		email: finalEmail || undefined,
		phone: finalPhone,
		address: location,
		location: coordinates,
		role: role.toLowerCase(),
		fcmToken: fcmToken || null,
	});
	await user.save();

	// Create corresponding profile
	let profile;
	if (role === "customer") {
		profile = new Customer({
			user: user._id,
			preferences: {
				marketingEmails: true,
				pushNotifications: true,
			},
		});
	} else if (role === "vendor") {
		profile = new VendorProfile({
			owner: user._id,
			name: user.name,
			location: {
				type: "Point",
				coordinates: coordinates.coordinates,
				address: location,
			},
			isActive: true,
		});
	} else if (role === "rider") {
		profile = new RiderProfile({
			user: user._id,
			status: "pending",
		});
	}
	await profile.save();

	// Provision Paystack Virtual Account for Customers ──
	if (role === "customer") {
		// Fire-and-forget async execution
		setImmediate(() => {
			(async () => {
				try {
					// 1. Fetch fresh customer with populated user
					const customerDoc = await Customer.findById(profile._id).populate(
						"user",
					);

					if (!customerDoc || !customerDoc.user) {
						throw new Error(
							"Customer or user document not found for DVA provisioning",
						);
					}

					// 2. Idempotency check (avoid duplicate provisioning)
					if (customerDoc.paystackCustomerCode && customerDoc.titanAccount) {
						logger.info(
							`DVA already exists for customer ${profile._id}, skipping provisioning`,
						);
						return;
					}

					// 3. Safe name parsing
					const fullName = customerDoc.user.name || "Customer";
					const nameParts = fullName.trim().split(" ");
					const firstName = nameParts[0];
					const lastName =
						nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Customer";

					// 4. Provision virtual account
					const { customerCode, titanAccount } =
						await provisionCustomerDVA(customerDoc);

					// 5. Update customer record
					await Customer.findByIdAndUpdate(profile._id, {
						firstName,
						lastName,
						paystackCustomerCode: customerCode,
						titanAccount,
					});

					logger.info(
						`✓ Titan DVA provisioned for customer ${firstName} ${lastName} (${profile._id})`,
					);
				} catch (err) {
					logger.error(
						`DVA provision failed for customer ${profile._id}: ${err.message}`,
					);
				}
			})();
		});
	}

	// === START KITCHEN SYNC ===
	// Only sync if the role is 'customer' or 'vendor'
	if (role === "customer" || role === "vendor") {
		let mirrorData = {
			_id: profile._id,
			email: user.email,
			phone: user.phone,
		};

		if (role === "customer") {
			// Split "John Doe" into ["John", "Doe"]
			const nameParts = user.name.trim().split(" ");
			mirrorData.firstName = nameParts[0];
			mirrorData.lastName =
				nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Customer";
		} else {
			// For vendors
			mirrorData.businessName = user.name;
			mirrorData.ownerName = user.name; // Placeholder for ownerName
		}

		syncUserToKitchen(role, mirrorData);
	}
	// === END KITCHEN SYNC ===

	const accessToken = generateAccessToken({
		id: user._id,
		role: user.role,
	});
	const refreshToken = generateRefreshToken({
		id: user._id,
		role: user.role,
	});

	await RefreshToken.create({
		token: refreshToken,
		user: user._id,
		ip: req.ip,
	});

	if (role === "customer" && finalEmail) {
		emailService
			.sendWelcomeEmail(finalEmail, name)
			.catch((err) => logger.error(`Welcome email failed: ${err.message}`));
	}

	res.status(201).json({
		success: true,
		accessToken,
		refreshToken,
		user: {
			id: user._id,
			name: user.name,
			email: user.email,
			phone: user.phone,
			role: user.role,
			profileId: profile._id,
		},
	});
	logger.info(
		`User registered: ${user._id} (${role}) with profile: ${profile._id}`,
	);
});

const login = asyncHandler(async (req, res) => {
	const { identifier } = req.body;
	if (!identifier) throw new AppError("Email or phone is required", 400);

	let user;
	if (identifier.includes("@"))
		user = await User.findOne({ email: identifier });
	else user = await User.findOne({ phone: identifier });

	if (!user) throw new AppError("Invalid credentials", 400);

	if (user.email && identifier.includes("@")) {
		const otp = generateOtp();
		await OtpVerification.deleteMany({ email: user.email, isEmail: true });
		await OtpVerification.create({ email: user.email, otp, isEmail: true });

		await emailService.sendOtpEmail(user.email, otp, "login");

		logger.info(`Login OTP sent to email: ${user.email}`);
		return res.json({ message: `OTP sent to email: ${user.email}` });
	}

	if (user.phone) {
		let { success, reference, error } = await requestSmsOtp(user.phone);
		if (!success) throw new AppError(error, 500);

		reference = reference || uuidv4();
		await OtpVerification.deleteMany({ phone: user.phone, isPhone: true });
		await OtpVerification.create({
			phone: user.phone,
			reference,
			isPhone: true,
		});

		logger.info(`Login OTP sent to phone: ${user.phone}`);
		return res.json({
			message: `OTP sent to phone: ${user.phone}`,
			reference,
		});
	}

	throw new AppError("Cannot send OTP. User profile incomplete.", 500);
});

const requestEmailOtp = asyncHandler(async (req, res) => {
	const { email, role, flow } = req.body;
	if (!email) throw new AppError("Email is required", 400);
	if (!role) throw new AppError("Role is required", 400);
	if (!flow) throw new AppError("Flow (login/signup) is required", 400);

	// For signup, check if email exists in ANY role to prevent duplicate registrations
	if (flow === "signup") {
		const existingUser = await User.findOne({ email });
		if (existingUser) {
			throw new AppError("Email already registered", 400);
		}
	}

	// For login, check for existing user and verify they have the correct role profile
	if (flow === "login") {
		const user = await User.findOne({ email });
		if (!user) {
			throw new AppError("No account found with this email", 404);
		}

		// Verify they have the correct role profile
		let hasProfile = false;
		if (role === "rider") {
			const profile = await RiderProfile.findOne({ user: user._id });
			hasProfile = !!profile;
		} else if (role === "vendor") {
			const profile = await VendorProfile.findOne({ owner: user._id });
			hasProfile = !!profile;
		} else if (role === "customer") {
			const profile = await Customer.findOne({ user: user._id });
			hasProfile = !!profile;
		} else {
			throw new AppError("Invalid role", 400);
		}

		if (!hasProfile) {
			throw new AppError(`No ${role} account found with this email`, 404);
		}
	}

	const otp = generateOtp();
	await OtpVerification.deleteMany({ email, isEmail: true });
	await OtpVerification.create({ email, otp, isEmail: true });

	await emailService.sendOtpEmail(
		email,
		otp,
		flow === "login" ? "login" : "verification",
	);

	return res.json({ success: true, message: "OTP sent to email" });
});

const verifyEmailOtp = asyncHandler(async (req, res) => {
	const { email, otp, role, flow, fcmToken } = req.body;
	if (!email || !otp) throw new AppError("Email and OTP required", 400);
	if (!role) throw new AppError("Role is required", 400);
	if (!flow) throw new AppError("Flow (login/signup) is required", 400);

	const record = await OtpVerification.findOne({ email, otp, isEmail: true });
	if (!record) throw new AppError("Invalid OTP", 400);

	await OtpVerification.deleteMany({ email, isEmail: true });

	// Handle signup flow - check if email exists in ANY role
	if (flow === "signup") {
		const existingUser = await User.findOne({ email });
		if (existingUser) {
			throw new AppError("Email already registered", 400);
		}

		const otpSession = jwt.sign({ email }, process.env.JWT_SECRET, {
			expiresIn: "30m",
		});
		return res.json({ success: true, otpSession });
	}

	// Handle login flow - find user and verify profile exists
	if (flow === "login") {
		const user = await User.findOne({ email });
		if (!user) {
			throw new AppError("No account found with this email", 404);
		}

		// Verify they have the correct role profile
		let profile = null;
		if (role === "rider") {
			profile = await RiderProfile.findOne({ user: user._id });
		} else if (role === "vendor") {
			profile = await VendorProfile.findOne({ owner: user._id });
		} else if (role === "customer") {
			profile = await Customer.findOne({ user: user._id });
		} else {
			throw new AppError("Invalid role", 400);
		}

		if (!profile) {
			throw new AppError(`No ${role} account found with this email`, 404);
		}
		// checkActiveUser && (await checkActiveUser(user._id));
		await validateUserStatus(user._id, user.role);

		if (fcmToken) {
			user.fcmToken = fcmToken;
			await user.save();
		}

		const accessToken = generateAccessToken({ id: user._id, role: user.role });
		const refreshToken = generateRefreshToken({
			id: user._id,
			role: user.role,
		});
		await RefreshToken.create({
			token: refreshToken,
			user: user._id,
			ip: req.ip,
		});

		return res.json({
			success: true,
			accessToken,
			refreshToken,
			user: {
				id: user._id,
				name: user.name,
				email: user.email,
				phone: user.phone,
				role: user.role,
				profileId: profile._id,
			},
		});
	}

	throw new AppError("Invalid flow. Must be 'login' or 'signup'", 400);
});

const requestPhoneOtp = asyncHandler(async (req, res) => {
	let { phone, role, flow } = req.body;
	if (!phone) throw new AppError("Phone required", 400);
	if (!role) throw new AppError("Role is required", 400);
	if (!flow) throw new AppError("Flow (login/signup) is required", 400);

	phone = normalizePhone(phone);

	// For signup, check if phone exists in ANY role to prevent duplicate registrations
	if (flow === "signup") {
		const existingUser = await User.findOne({ phone });
		if (existingUser) {
			const existingRole = existingUser.role;
			let message, errorCode;
			if (existingRole === "rider") {
				message =
					"This phone number is already registered as a Rider account. Please log in as a Rider or use another number.";
				errorCode = "RIDER_ACCOUNT_EXISTS";
			} else if (existingRole === "vendor") {
				message =
					"This phone number is already registered as a Vendor account. Please log in as a Vendor or use another number.";
				errorCode = "VENDOR_ACCOUNT_EXISTS";
			} else {
				message = "Phone number already registered";
				errorCode = "PHONE_EXISTS";
			}
			const err = new AppError(message, 400);
			err.error = { code: errorCode };
			throw err;
		}
	}

	// For login, check for existing user and verify they have the correct role profile
	if (flow === "login") {
		const user = await User.findOne({ phone });
		if (!user) {
			throw new AppError("No account found with this phone number", 404);
		}

		// Verify they have the correct role profile
		let hasProfile = false;
		if (role === "rider") {
			const profile = await RiderProfile.findOne({ user: user._id });
			hasProfile = !!profile;
		} else if (role === "vendor") {
			const profile = await VendorProfile.findOne({ owner: user._id });
			hasProfile = !!profile;
		} else if (role === "customer") {
			const profile = await Customer.findOne({ user: user._id });
			hasProfile = !!profile;
		} else {
			throw new AppError("Invalid role", 400);
		}

		if (!hasProfile) {
			// Check if the number belongs to the other role
			let actualRole = null;
			if (role === "rider") {
				const vendorProfile = await VendorProfile.findOne({ owner: user._id });
				if (vendorProfile) actualRole = "vendor";
			} else if (role === "vendor") {
				const riderProfile = await RiderProfile.findOne({ user: user._id });
				if (riderProfile) actualRole = "rider";
			}

			if (actualRole) {
				const err = new AppError(
					`This number is registered as a ${actualRole} account. Do you want to login as a ${actualRole}?`,
					400,
				);
				err.error = {
					code:
						actualRole === "vendor" ? "WRONG_ROLE_VENDOR" : "WRONG_ROLE_RIDER",
				};
				throw err;
			}

			throw new AppError(
				`No ${role} account found with this phone number`,
				404,
			);
		}
	}

	let { success, reference, error } = await requestSmsOtp(phone);
	if (!success) throw new AppError(error, 500);

	reference = reference || uuidv4();
	await OtpVerification.deleteMany({ phone, isPhone: true });
	await OtpVerification.create({
		phone,
		reference,
		otp: null,
		isPhone: true,
	});

	return res.json({ message: "OTP sent to phone", reference });
});

const verifyPhoneOtp = asyncHandler(async (req, res) => {
	let { phone, otp, reference, role, flow, fcmToken } = req.body;
	if (!phone || !otp || !reference)
		throw new AppError("Phone, OTP, reference required", 400);
	if (!role) throw new AppError("Role is required", 400);
	if (!flow) throw new AppError("Flow (login/signup) is required", 400);

	phone = normalizePhone(phone);

	const record = await OtpVerification.findOne({
		phone,
		reference,
		isPhone: true,
	});

	if (!record) throw new AppError("Invalid verification session", 400);

	const { success, error } = await verifySmsOtp(otp, reference);
	if (!success) throw new AppError(error, 400);

	await OtpVerification.deleteOne({ phone, reference, isPhone: true });

	// Handle signup flow - check if phone exists in ANY role
	if (flow === "signup") {
		const existingUser = await User.findOne({ phone });
		if (existingUser) {
			throw new AppError("Phone number already registered", 400);
		}

		const otpSession = jwt.sign({ phone }, process.env.JWT_SECRET, {
			expiresIn: "30m",
		});
		return res.json({ success: true, otpSession });
	}

	// Handle login flow - find user and verify profile exists
	if (flow === "login") {
		const user = await User.findOne({ phone });
		if (!user) {
			throw new AppError("No account found with this phone number", 404);
		}

		// Verify they have the correct role profile
		let profile = null;
		if (role === "rider") {
			profile = await RiderProfile.findOne({ user: user._id });
		} else if (role === "vendor") {
			profile = await VendorProfile.findOne({ owner: user._id });
		} else if (role === "customer") {
			profile = await Customer.findOne({ user: user._id });
		} else {
			throw new AppError("Invalid role", 400);
		}

		if (!profile) {
			throw new AppError(
				`No ${role} account found with this phone number`,
				404,
			);
		}
		// checkActiveUser && (await checkActiveUser(user._id));
		await validateUserStatus(user._id, user.role);

		if (fcmToken) {
			user.fcmToken = fcmToken;
			await user.save();
		}

		const accessToken = generateAccessToken({ id: user._id, role: user.role });
		const refreshToken = generateRefreshToken({
			id: user._id,
			role: user.role,
		});
		await RefreshToken.create({
			token: refreshToken,
			user: user._id,
			ip: req.ip,
		});

		return res.json({
			success: true,
			accessToken,
			refreshToken,
			user: {
				id: user._id,
				name: user.name,
				email: user.email,
				phone: user.phone,
				role: user.role,
				profileId: profile._id,
			},
		});
	}

	throw new AppError("Invalid flow. Must be 'login' or 'signup'", 400);
});

const logOut = asyncHandler(async (req, res) => {
	const { refreshToken } = req.body;
	if (!refreshToken) return res.sendStatus(204);

	const tokenRecord = await RefreshToken.findOne({ token: refreshToken });
	if (tokenRecord) {
		const user = await User.findById(tokenRecord.user).select("role");
		if (user?.role === "vendor") {
			await VendorProfile.updateOne(
				{ owner: tokenRecord.user, "storeDetails.0": { $exists: true } },
				{ $set: { "storeDetails.0.status": "inactive" } }
			);
		}
	}

	await RefreshToken.deleteOne({ token: refreshToken });
	res.json({ message: "Logged out successfully" });
});

const refresh = asyncHandler(async (req, res) => {
	const { refreshToken } = req.body;
	if (!refreshToken) throw new AppError("Refresh token required", 401);

	const tokenRecord = await RefreshToken.findOne({ token: refreshToken });
	if (!tokenRecord) throw new AppError("Invalid refresh token", 403);

	let decoded;
	try {
		decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
	} catch (err) {
		await RefreshToken.deleteOne({ token: refreshToken });
		throw new AppError("Refresh token expired or invalid", 403);
	}

	const user = await User.findById(decoded.id);
	if (!user) throw new AppError("User not found", 401);

	// Rotate: delete old token, issue new refresh token
	await RefreshToken.deleteOne({ token: refreshToken });
	const newRefreshToken = generateRefreshToken({
		id: user._id,
		role: user.role,
	});
	await RefreshToken.create({
		token: newRefreshToken,
		user: user._id,
		ip: req.ip,
	});

	const accessToken = generateAccessToken({ id: user._id, role: user.role });
	res.json({ accessToken, refreshToken: newRefreshToken });
});

const checkUserExist = asyncHandler(async (req, res) => {
	let { email, phone } = req.body;
	if (!email && !phone) {
		throw new AppError("Email or Phone is required", 400);
	}

	let user = null;
	if (email) {
		user = await User.findOne({ email });
	} else if (phone) {
		const normalizedPhone = normalizePhone(phone);
		user = await User.findOne({ phone: normalizedPhone });
	}

	if (user) {
		return res.status(200).json({ exists: true, message: "User exists" });
	}

	return res
		.status(200)
		.json({ exists: false, message: "User does not exist" });
});

const updateFcmToken = asyncHandler(async (req, res) => {
	const { fcmToken } = req.body;
	const userId = req.user.id;

	if (!fcmToken) {
		throw new AppError("FCM token is required", 400);
	}

	await User.findByIdAndUpdate(userId, { fcmToken });
	res.status(200).json({ success: true, message: "Device token saved!" });
});

const checkPhone = asyncHandler(async (req, res) => {
	let { phone, role } = req.body;
	if (!phone || !role) throw new AppError("Phone and role required", 400);

	phone = normalizePhone(phone);
	const user = await User.findOne({ phone });

	if (!user) return res.json({ exists: false });

	const [vendorProfile, riderProfile] = await Promise.all([
		VendorProfile.findOne({ owner: user._id }),
		RiderProfile.findOne({ user: user._id }),
	]);

	if (vendorProfile && role !== "vendor") {
		return res.json({
			exists: true,
			role: "vendor",
			message:
				"This number is already registered as a Vendor. Do you want to login as a Vendor?",
		});
	}
	if (riderProfile && role !== "rider") {
		return res.json({
			exists: true,
			role: "rider",
			message:
				"This number is already registered as a Rider. Do you want to login as a Rider?",
		});
	}

	return res.json({ exists: false });
});

module.exports = {
	register,
	login,
	requestEmailOtp,
	verifyEmailOtp,
	requestPhoneOtp,
	verifyPhoneOtp,
	logOut,
	refresh,
	checkUserExist,
	updateFcmToken,
	checkPhone,
};
