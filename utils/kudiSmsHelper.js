// utilis/kudiSmsHelper.js
const axios = require("axios");

// Base URL for KudiSMS OTP API
const KUDISMS_API_BASE_URL = "https://my.kudisms.net/api/";

// Environment variables
const SENDER_ID = process.env.KUDISMS_SENDER_ID;
const TEMPLATE_CODE = process.env.KUDISMS_TEMPLATE_CODE;
const API_KEY = process.env.KUDISMS_API_KEY;
const APP_NAME_CODE = process.env.KUDISMS_APP_CODE;
const OTP_TYPE = process.env.KUDISMS_OTP_TYPE || "numeric";
const OTP_LENGTH = process.env.KUDISMS_OTP_LENGTH || 6;
const OTP_DURATION = process.env.KUDISMS_OTP_DURATION || 5;
const OTP_ATTEMPTS = process.env.KUDISMS_OTP_ATTEMPTS || 3;

// --- Function to Request/Send OTP ---
const requestSmsOtp = async (phoneNumber) => {
	try {
		const phoneString = String(phoneNumber);
		const cleanNumber = phoneString.replace(/[^0-9]/g, "");

		const requestBody = {
			token: API_KEY,
			recipients: cleanNumber,
			senderID: SENDER_ID,
			appnamecode: APP_NAME_CODE,
			templatecode: TEMPLATE_CODE,
			channel: "sms",
			msg: "Message\r\nSent Successfully",
			otp_type: OTP_TYPE,
			otp_length: OTP_LENGTH,
			otp_duration: OTP_DURATION,
			otp_attempts: OTP_ATTEMPTS,
		};

		console.log("Sending OTP request to KudiSMS for:", cleanNumber);

		const response = await axios.post(
			`${KUDISMS_API_BASE_URL}sendotp`,
			requestBody
		);

		console.log("KudiSMS sendOTP response:", response.data);

		if (response.data && response.data.status === "success") {
			// Use verification_id from response (NOT the data field)
			const reference = response.data.verification_id;

			if (!reference) {
				console.error("KudiSMS returned success but no verification_id!");
				return {
					success: false,
					error: "No reference received from SMS service",
				};
			}

			console.log("Using verification_id for verification:", reference);
			return { success: true, reference: reference };
		} else {
			console.error("KudiSMS Send OTP Error Response:", response.data);
			return {
				success: false,
				error: response.data.message || "Failed to send OTP via KudiSMS",
			};
		}
	} catch (error) {
		console.error(
			"KudiSMS Send OTP Request Failed:",
			error.response?.data || error.message
		);
		return {
			success: false,
			error: error.response?.data?.message || "Network or API call error.",
		};
	}
};

// --- Function to Verify OTP ---
const verifySmsOtp = async (otp, reference) => {
	try {
		const requestBody = {
			token: API_KEY,
			verification_id: reference,
			otp: otp,
		};

		console.log("Verifying OTP with KudiSMS:");
		console.log("Request body:", JSON.stringify(requestBody, null, 2));

		const response = await axios.post(
			`${KUDISMS_API_BASE_URL}verifyotp`,
			requestBody
		);

		console.log("KudiSMS verifyOTP response:", response.data);

		if (response.data && response.data.status === "success") {
			return { success: true };
		} else {
			console.error("KudiSMS Verify OTP Error Response:", response.data);
			return {
				success: false,
				error:
					response.data.msg ||
					response.data.message ||
					"Invalid OTP or Reference.",
			};
		}
	} catch (error) {
		console.error(
			"KudiSMS Verify OTP Request Failed:",
			error.response?.data || error.message
		);
		return {
			success: false,
			error:
				error.response?.data?.msg ||
				error.response?.data?.message ||
				"Network or API call error.",
		};
	}
};

module.exports = { requestSmsOtp, verifySmsOtp };
