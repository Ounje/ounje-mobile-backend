const rateLimit = require("express-rate-limit");

const otpRequestLimiter = rateLimit({
	windowMs: 60 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 5 OTP requests per windowMs
	message: {
		error:
			"Too many OTP requests from this IP, please try again after 15 minutes",
	},
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: false,
});

// Rate limiter for OTP verification endpoints
const otpVerifyLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10,
	message: {
		error:
			"Too many verification attempts from this IP, please try again after 15 minutes",
	},
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
});

const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10, // Limit each IP to 10 login attempts per windowMs
	message: {
		error:
			"Too many login attempts from this IP, please try again after 15 minutes",
	},
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
});

const registerLimiter = rateLimit({
	windowMs: 60 * 60 * 1000, // 1 hour
	max: 3, // Only 3 registrations per hour per IP
	message: {
		error:
			"Too many registration attempts from this IP, please try again after 1 hour",
	},
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
});

module.exports = {
	otpRequestLimiter,
	otpVerifyLimiter,
	loginLimiter,
	registerLimiter,
};
