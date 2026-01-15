const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const OtpVerification = require("../models/OtpVerification");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const Rider = require("../models/Rider");
const {
	generateAccessToken,
	generateRefreshToken,
} = require("../utilis/generateToken");
const RefreshToken = require("../models/RefreshToken");
const { requestSmsOtp, verifySmsOtp } = require("../utilis/kudiSmsHelper");
const { getCoordsFromAddress } = require("../utilis/delivery");
const { v4: uuidv4 } = require("uuid");

// --- NEW NODEMAILER & OTP HELPERS ---

// 1. Nodemailer Transporter
const transporter = nodemailer.createTransport({
	// Using Gmail is common, but you must use an App Password for EMAIL_PASS
	service: "gmail",
	auth: {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASS,
	},
});

// 2. Local OTP Generator
const generateOtp = (length = 4) =>
	Math.floor(1000 + Math.random() * 9000).toString();

// controllers/authController.js
const register = async (req, res) => {
	try {
		// 'location' in req.body is the address string from the frontend
		const { name, role, location, phone, email, otpSession, operatingArea } =
			req.body;

		if (!otpSession)
			return res.status(400).json({ error: "OTP session token is required" });

		const decoded = jwt.verify(otpSession, process.env.JWT_SECRET);

		// Use email/phone from otpSession OR from request body
		const finalEmail = decoded.email || email;
		const finalPhone = decoded.phone || phone;

		// Validate required fields
		if (!name || (!finalEmail && !finalPhone))
			return res
				.status(400)
				.json({ error: "Missing required fields (name, email/phone)" });
		// --- FIXED GEOLOCATION LOGIC ---
		// 'location' here is the text address string (e.g., "123 Street, Ikeja")
		const geo = await getCoordsFromAddress(location);
		if (!geo)
			return res.status(400).json({ error: "Invalid address provided" });

		const coordinates = {
			type: "Point",
			coordinates: [geo.lng, geo.lat], // Google uses lng/lat, MongoDB uses [lng, lat]
		};
		// --- USER CREATION WITH BOTH STRING AND POINT ---
		const userProps = {
			name,
			email: finalEmail,
			phone: finalPhone,
			address: location, // SAVES THE STRING FOR PRICING
			location: coordinates, // SAVES THE POINT FOR MAPS
		};

		let user;
		if (role === "customer") user = new Customer(userProps);
		else if (role === "vendor") user = new Vendor(userProps);
		else if (role === "rider")
			user = new Rider({ ...userProps, operatingArea });
		else return res.status(400).json({ error: "Invalid role specified" });

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

// --- LOGIN ---
const login = async (req, res) => {
	try {
		const { identifier } = req.body; // <-- RENAMED 'email' to 'identifier'
		if (!identifier)
			return res.status(400).json({ error: "Missing email or phone number" });

		// Simple check to determine if the input is likely an email or a phone number
		let user = identifier.includes("@")
			? await User.findOne({ email: identifier })
			: await User.findOne({ phone: identifier });

		if (!user) return res.status(400).json({ error: "Invalid credentials" });

		// Email OTP
		if (user.email && identifier.includes("@")) {
			const otp = generateOtp(4);
			await OtpVerification.create({ email: user.email, otp });

			const mailOptions = {
				from: process.env.EMAIL_USER,
				to: user.email,
				subject: "Login Verification OTP",
				html: `<p>Your login code is:</p><h2>${otp}</h2>`,
			};

			try {
				await transporter.sendMail(mailOptions);
				return res.json({ message: `OTP Sent to email: ${user.email}` });
			} catch (mailError) {
				console.error("Email send error:", mailError);
				return res.status(500).json({ error: "Failed to send OTP email." });
			}
		}

		// Phone OTP
		if (user.phone) {
			let { success, reference, error } = await requestSmsOtp(user.phone);
			if (!success) return res.status(500).json({ error });

			// fallback reference if KudiSMS didn't return one
			reference = reference || uuidv4();

			await OtpVerification.create({
				phone: user.phone,
				reference,
				isPhone: true,
			});
			return res.json({
				message: `OTP Sent to phone: ${user.phone}`,
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

// --- REQUEST & VERIFY EMAIL OTP ---
const requestOtp = async (req, res) => {
	try {
		const { email } = req.body;
		if (!email) return res.status(400).json({ error: "Email is required" });

		const exists = await User.findOne({ email });
		if (exists) return res.status(400).json({ error: "Email already in use" });

		const otp = generateOtp(4);
		await OtpVerification.create({ email, otp });

		await transporter.sendMail({
			from: process.env.EMAIL_USER,
			to: email,
			subject: "Email Verification OTP",
			html: `<p>Your code is:</p><h2>${otp}</h2>`,
		});

		res.json({ message: "OTP sent to email" });
	} catch (err) {
		console.error("Request OTP Error:", err);
		res.status(500).json({ error: "Failed to send OTP email" });
	}
};

const verifyOtp = async (req, res) => {
	try {
		const { email, otp } = req.body;
		if (!email || !otp)
			return res.status(400).json({ error: "Email and OTP required" });

		const record = await OtpVerification.findOne({ email, otp });
		if (!record) return res.status(400).json({ error: "Invalid OTP" });

		await OtpVerification.deleteMany({ email });

		const user = await User.findOne({ email });
		if (user) {
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
				},
			});
		}

		const otpSession = jwt.sign({ email }, process.env.JWT_SECRET, {
			expiresIn: "30m",
		});
		res.json({ success: true, otpSession });
	} catch (err) {
		console.error("Verify OTP Error:", err);
		res.status(500).json({ error: err.message });
	}
};

// --- PHONE OTP ---
const requestPhoneOtp = async (req, res) => {
	try {
		const { phone } = req.body;
		if (!phone) return res.status(400).json({ error: "Phone required" });

		const exists = await User.findOne({ phone });
		if (exists) return res.status(400).json({ error: "Phone already in use" });

		let { success, reference, error } = await requestSmsOtp(phone);
		if (!success) return res.status(500).json({ error });

		// fallback reference if KudiSMS didn't return one
		reference = reference || uuidv4();

		await OtpVerification.create({ phone, reference, isPhone: true });
		res.json({ message: "OTP sent to phone", reference });
	} catch (err) {
		console.error("Request Phone OTP Error:", err);
		res.status(500).json({ error: err.message });
	}
};

const verifyPhoneOtp = async (req, res) => {
	try {
		const { phone, otp, reference } = req.body;
		if (!phone || !otp || !reference)
			return res
				.status(400)
				.json({ error: "Phone, OTP, and reference required" });

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
		if (user) {
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
				},
			});
		}

		const otpSession = jwt.sign({ phone }, process.env.JWT_SECRET, {
			expiresIn: "30m",
		});
		res.json({ success: true, otpSession });
	} catch (err) {
		console.error("Verify Phone OTP Error:", err);
		res.status(500).json({ error: err.message });
	}
};

// --- LOGOUT ---
const logOut = async (req, res) => {
	try {
		const token = req.body.refreshToken;
		if (!token) return res.sendStatus(204);

		await RefreshToken.deleteOne({ token });
		res.json({ message: "Logged out successfully" });
	} catch (err) {
		console.error("Logout Error:", err);
		res.status(500).json({ error: err.message });
	}
};

// --- REFRESH ---
const refresh = async (req, res) => {
	try {
		const token = req.body.refreshToken;
		if (!token)
			return res.status(401).json({ error: "Refresh token required" });

		const refreshExists = await RefreshToken.findOne({ token });
		if (!refreshExists)
			return res.status(403).json({ error: "Invalid refresh token" });

		const decoded = jwt.verify(token, process.env.REFRESH_SECRET);
		const user = await User.findById(decoded.id);
		if (!user) return res.status(401).json({ error: "User not found" });

		const newAccessToken = generateAccessToken({
			id: user._id,
			role: user.role,
		});
		res.json({ accessToken: newAccessToken });
	} catch (err) {
		console.error("Refresh Error:", err);
		res.status(401).json({ error: err.message });
	}
};

module.exports = {
	register,
	login,
	requestOtp,
	verifyOtp,
	requestPhoneOtp,
	verifyPhoneOtp,
	logOut,
	refresh,
};
