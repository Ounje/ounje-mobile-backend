const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {
	User,
	Customer,
	Vendor,
	Rider,
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

const register = asyncHandler(async (req, res) => {
	const { name, role, phone, location, email, otpSession, operatingArea } =
		req.body;

	if (!otpSession) throw new AppError("OTP session token is required", 400);

	const decoded = jwt.verify(otpSession, process.env.JWT_SECRET);

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

	const userProps = {
		name,
		email: finalEmail || undefined,
		phone: finalPhone,
		address: location,
		location: coordinates,
	};

	let user;
	if (role === "customer") user = new Customer(userProps);
	else if (role === "vendor") user = new Vendor(userProps);
	else if (role === "rider") user = new Rider({ ...userProps, operatingArea });

	await user.save();

	// === START KITCHEN SYNC ===
	// Only sync if the role is 'customer' or 'vendor'
	if (role === "customer" || role === "vendor") {
		let mirrorData = {
			_id: user._id,
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
		},
	});
	logger.info(`User registered: ${user._id} (${role})`);
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
	const { email } = req.body;
	if (!email) throw new AppError("Email is required", 400);

	const exists = await User.findOne({ email });
	if (exists) throw new AppError("Email already in use", 400);

	const otp = generateOtp();
	await OtpVerification.deleteMany({ email, isEmail: true });
	await OtpVerification.create({ email, otp, isEmail: true });

	await emailService.sendOtpEmail(email, otp, "verification");

	res.json({ success: true, message: "OTP sent to email" });
});

const verifyEmailOtp = asyncHandler(async (req, res) => {
	const { email, otp } = req.body;
	if (!email || !otp) throw new AppError("Email and OTP required", 400);

	const record = await OtpVerification.findOne({ email, otp, isEmail: true });
	if (!record) throw new AppError("Invalid OTP", 400);

	await OtpVerification.deleteMany({ email, isEmail: true });

	const user = await User.findOne({ email });
	if (!user) {
		const otpSession = jwt.sign({ email }, process.env.JWT_SECRET, {
			expiresIn: "30m",
		});
		return res.json({ success: true, otpSession });
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

	res.json({
		success: true,
		accessToken,
		refreshToken,
		user: {
			id: user._id,
			name: user.name,
			email: user.email,
			phone: user.phone,
			role: user.role,
		},
	});
});

const requestPhoneOtp = asyncHandler(async (req, res) => {
	let { phone } = req.body;
	if (!phone) throw new AppError("Phone required", 400);

	phone = normalizePhone(phone);

	const exists = await User.findOne({ phone });
	if (exists) throw new AppError("Phone already in use", 400);

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

	res.json({ message: "OTP sent to phone", reference });
});

const verifyPhoneOtp = asyncHandler(async (req, res) => {
	let { phone, otp, reference } = req.body;
	if (!phone || !otp || !reference)
		throw new AppError("Phone, OTP, reference required", 400);

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

	const user = await User.findOne({ phone });
	if (!user) {
		const otpSession = jwt.sign({ phone }, process.env.JWT_SECRET, {
			expiresIn: "30m",
		});
		return res.json({ success: true, otpSession });
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

	res.json({
		success: true,
		accessToken,
		refreshToken,
		user: {
			id: user._id,
			name: user.name,
			email: user.email,
			phone: user.phone,
			role: user.role,
		},
	});
});

const logOut = asyncHandler(async (req, res) => {
	const { refreshToken } = req.body;
	if (!refreshToken) return res.sendStatus(204);

	await RefreshToken.deleteOne({ token: refreshToken });
	res.json({ message: "Logged out successfully" });
});

const refresh = asyncHandler(async (req, res) => {
	const { refreshToken } = req.body;
	if (!refreshToken) throw new AppError("Refresh token required", 401);

	const tokenExists = await RefreshToken.findOne({ token: refreshToken });
	if (!tokenExists) throw new AppError("Invalid refresh token", 403);

	const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
	const user = await User.findById(decoded.id);
	if (!user) throw new AppError("User not found", 401);

	const accessToken = generateAccessToken({ id: user._id, role: user.role });
	res.json({ accessToken });
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
};
