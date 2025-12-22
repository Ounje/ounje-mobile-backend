// utilis/kudiSmsHelper.js
const axios = require('axios');

// Base URL for KudiSMS OTP API
const KUDISMS_API_BASE_URL = "https://my.kudisms.net/api/";

// ⚠️ IMPORTANT: These must be approved and retrieved from KudiSMS portal (Step 5)
const SENDER_ID = process.env.KUDISMS_SENDER_ID;
// const APP_NAME_CODE = process.env.KUDISMS_APP_CODE;
const TEMPLATE_CODE = process.env.KUDISMS_TEMPLATE_CODE;
const API_KEY = process.env.KUDISMS_API_KEY;

const OTP_TYPE = process.env.KUDISMS_OTP_TYPE || 'numeric'; // e.g., 'numeric' or 'alphanumeric'
const OTP_LENGTH = process.env.KUDISMS_OTP_LENGTH || 6;     // e.g., 6 digits
const OTP_DURATION = process.env.KUDISMS_OTP_DURATION || 5;   // Minutes, e.g., 5 minutes
const OTP_ATTEMPTS = process.env.KUDISMS_OTP_ATTEMPTS || 3;   // Number of attempts

const APP_NAME_CODE = process.env.KUDISMS_APP_CODE; // <--- Make sure this line is present (it was commented out)

// --- Function to Request/Send OTP ---
const requestSmsOtp = async (phoneNumber) => {
    // Check if it's a number and convert to string
    const phoneString = String(phoneNumber);
    
    // KudiSMS expects the phone number without the leading plus sign, 
    // and usually in international format (e.g., 23480...)
    const cleanNumber = phoneString.replace(/[^0-9]/g, ''); 

    const requestBody = {
        // --- MATCHING REQUIRED PARAMETER NAMES ---
        token: API_KEY,             // Changed from api_key
        recipients: cleanNumber,    // Changed from to
        senderID: SENDER_ID,        // Changed from sender
        appnamecode: APP_NAME_CODE, // MUST be included and defined
        
        // --- OPTIONAL/OTP SPECIFIC PARAMETERS (Keep for now) ---
        templatecode: TEMPLATE_CODE,
        channel: 'sms', 
        msg: "Message\r\nSent Successfully", // Note: The OTP text might override this!
        otp_type: OTP_TYPE,
        otp_length: OTP_LENGTH,
        otp_duration: OTP_DURATION,
        otp_attempts: OTP_ATTEMPTS
    };

    try {
        const response = await axios.post(`${KUDISMS_API_BASE_URL}sendotp`, requestBody);
        
        // KudiSMS API success response structure is often: { status: 'OK', reference: '...' }
        if (response.data && response.data.status === 'success') {
            // The reference is a crucial identifier needed for verification
            return { success: true, reference: response.data.reference };
        } else {
            console.error("KudiSMS Send OTP Error Response:", response.data);
            return { success: false, error: response.data.message || "Failed to send OTP via KudiSMS" };
        }
    } catch (error) {
        console.error("KudiSMS Send OTP Request Failed:", error.message);
        return { success: false, error: "Network or API call error." };
    }
};

// --- Function to Verify OTP ---
const verifySmsOtp = async (otp, reference) => {
    const requestBody = {
        api_key: API_KEY,
        otp,
        reference,
    };

    try {
        const response = await axios.post(`${KUDISMS_API_BASE_URL}verifyotp`, requestBody);
        
        // KudiSMS API success response structure for verification is often: { status: 'OK' }
        if (response.data && response.data.status === 'success') {
            return { success: true };
        } else {
            console.error("KudiSMS Verify OTP Error Response:", response.data);
            return { success: false, error: response.data.message || "Invalid OTP or Reference." };
        }
    } catch (error) {
        console.error("KudiSMS Verify OTP Request Failed:", error.message);
        return { success: false, error: "Network or API call error." };
    }
};


module.exports = { requestSmsOtp, verifySmsOtp };