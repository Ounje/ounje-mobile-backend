const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");

const User = require("../models/User");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const Rider = require("../models/Rider");
const OtpVerification = require("../models/OtpVerification");
const RefreshToken = require("../models/RefreshToken");

const {
	generateAccessToken,
	generateRefreshToken,
} = require("../utilis/generateToken");
const { requestSmsOtp, verifySmsOtp } = require("../utilis/kudiSmsHelper");
const { getCoordsFromAddress } = require("../utilis/delivery");

const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASS,
	},
});

const generateOtp = () => Math.floor(1000 + Math.random() * 9000).toString();

const register = async (req, res) => {
	try {
		const { name, role, phone, location, email, otpSession, operatingArea } =
			req.body;

		if (!otpSession)
			return res.status(400).json({ error: "OTP session token is required" });

		const decoded = jwt.verify(otpSession, process.env.JWT_SECRET);

		let finalPhone = phone || null;
		let finalEmail = email || null;

		if (role === "vendor" || role === "rider") {
			if (!decoded.phone)
				return res
					.status(400)
					.json({ error: "Phone OTP required for vendor/rider" });
			finalPhone = decoded.phone;
		} else if (role === "customer") {
			finalPhone = decoded.phone || phone;
			finalEmail = decoded.email || email;
		} else {
			return res.status(400).json({ error: "Invalid role" });
		}

		if (!name || (!finalEmail && !finalPhone))
			return res.status(400).json({ error: "Missing required fields" });

		if ((role === "vendor" || role === "rider") && !finalPhone)
			return res
				.status(400)
				.json({ error: "Phone number required for vendor/rider" });

		if (finalEmail) {
			const existingEmail = await User.findOne({ email: finalEmail });
			if (existingEmail)
				return res.status(400).json({ error: "Email already exists" });
		}
		if (finalPhone) {
			const existingPhone = await User.findOne({ phone: finalPhone });
			if (existingPhone)
				return res.status(400).json({ error: "Phone already exists" });
		}

		const geo = await getCoordsFromAddress(location);
		if (!geo) return res.status(400).json({ error: "Invalid address" });

		const coordinates = { type: "Point", coordinates: [geo.lng, geo.lat] };

		const userProps = {
			name,
			email: finalEmail,
			phone: finalPhone,
			address: location,
			location: coordinates,
		};

		let user;
		if (role === "customer") user = new Customer(userProps);
		else if (role === "vendor") user = new Vendor(userProps);
		else if (role === "rider")
			user = new Rider({ ...userProps, operatingArea });

		await user.save();

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
	} catch (err) {
		console.error("Register Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const login = async (req, res) => {
	try {
		const { identifier } = req.body;
		if (!identifier)
			return res.status(400).json({ error: "Email or phone is required" });

		let user;
		if (identifier.includes("@"))
			user = await User.findOne({ email: identifier });
		else user = await User.findOne({ phone: identifier });

		if (!user) return res.status(400).json({ error: "Invalid credentials" });

		if (user.email && identifier.includes("@")) {
			const otp = generateOtp();
			await OtpVerification.deleteMany({ email: user.email, isEmail: true });
			await OtpVerification.create({ email: user.email, otp, isEmail: true });

			await transporter.sendMail({
				from: process.env.EMAIL_USER,
				to: user.email,
				subject: "Login Verification OTP",
				html: `<p>Your login OTP:</p><h2>${otp}</h2>`,
			});

			return res.json({ message: `OTP sent to email: ${user.email}` });
		}

		if (user.phone) {
			let { success, reference, error } = await requestSmsOtp(user.phone);
			if (!success) return res.status(500).json({ error });

			reference = reference || uuidv4();
			await OtpVerification.deleteMany({ phone: user.phone, isPhone: true });
			await OtpVerification.create({
				phone: user.phone,
				reference,
				isPhone: true,
			});

			return res.json({
				message: `OTP sent to phone: ${user.phone}`,
				reference,
			});
		}

		return res
			.status(500)
			.json({ error: "Cannot send OTP. User profile incomplete." });
	} catch (err) {
		console.error("Login Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const requestEmailOtp = async (req, res) => {
	try {
		const { email } = req.body;
		if (!email) return res.status(400).json({ error: "Email is required" });

		const exists = await User.findOne({ email });
		if (exists) return res.status(400).json({ error: "Email already in use" });

		const otp = generateOtp();
		await OtpVerification.deleteMany({ email, isEmail: true });
		await OtpVerification.create({ email, otp, isEmail: true });

		await transporter.sendMail({
			from: process.env.EMAIL_USER,
			to: email,
			subject: "Email Verification OTP",
			html: `<p>Your code:</p><h2>${otp}</h2>`,
		});

		res.json({ success: true, message: "OTP sent to email" });
	} catch (err) {
		console.error("Request Email OTP Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const verifyEmailOtp = async (req, res) => {
	try {
		const { email, otp } = req.body;
		if (!email || !otp)
			return res.status(400).json({ error: "Email and OTP required" });

		const record = await OtpVerification.findOne({ email, otp, isEmail: true });
		if (!record) return res.status(400).json({ error: "Invalid OTP" });

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
	} catch (err) {
		console.error("Verify Email OTP Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const requestPhoneOtp = async (req, res) => {
	try {
		const { phone } = req.body;
		if (!phone) return res.status(400).json({ error: "Phone required" });

		const exists = await User.findOne({ phone });
		if (exists) return res.status(400).json({ error: "Phone already in use" });

		let { success, reference, error } = await requestSmsOtp(phone);
		if (!success) return res.status(500).json({ error });

		reference = reference || uuidv4();
		await OtpVerification.deleteMany({ phone, isPhone: true });
		await OtpVerification.create({
			phone,
			reference,
			otp: null,
			isPhone: true,
		});

		res.json({ message: "OTP sent to phone", reference });
	} catch (err) {
		console.error("Request Phone OTP Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const verifyPhoneOtp = async (req, res) => {
	try {
		let { phone, otp, reference } = req.body;
		if (!phone || !otp || !reference)
			return res.status(400).json({ error: "Phone, OTP, reference required" });

		const normalizePhone = (phone) => {
			phone = phone.trim();
			if (phone.startsWith("0")) phone = phone.slice(1);
			if (phone.startsWith("234")) phone = phone.slice(3);
			return phone;
		};

		phone = normalizePhone(phone);
		const record = await OtpVerification.findOne({
			phone,
			reference,
			isPhone: true,
		});

		if (!record)
			return res.status(400).json({ error: "Invalid verification session" });

		const { success, error } = await verifySmsOtp(otp, reference);
		if (!success) return res.status(400).json({ error });

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
	} catch (err) {
		console.error("Verify Phone OTP Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const logOut = async (req, res) => {
	try {
		const { refreshToken } = req.body;
		if (!refreshToken) return res.sendStatus(204);

		await RefreshToken.deleteOne({ token: refreshToken });
		res.json({ message: "Logged out successfully" });
	} catch (err) {
		console.error("Logout Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const refresh = async (req, res) => {
	try {
		const { refreshToken } = req.body;
		if (!refreshToken)
			return res.status(401).json({ error: "Refresh token required" });

		const tokenExists = await RefreshToken.findOne({ token: refreshToken });
		if (!tokenExists)
			return res.status(403).json({ error: "Invalid refresh token" });

		const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
		const user = await User.findById(decoded.id);
		if (!user) return res.status(401).json({ error: "User not found" });

		const accessToken = generateAccessToken({ id: user._id, role: user.role });
		res.json({ accessToken });
	} catch (err) {
		console.error("Refresh Error:", err);
		res.status(401).json({ error: err.message });
	}
};

module.exports = {
	register,
	login,
	requestEmailOtp,
	verifyEmailOtp,
	requestPhoneOtp,
	verifyPhoneOtp,
	logOut,
	refresh,
};
