// controllers/authController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/User");
// const NodemailerHelper = require('nodemailer-otp');
const OtpVerification = require("../models/OtpVerification");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const Rider = require("../models/Rider");
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utilis/generateToken");
const RefreshToken = require("../models/RefreshToken");
// const helper = new NodemailerHelper(process.env.EMAIL_USER, process.env.EMAIL_PASS);
const { requestSmsOtp, verifySmsOtp } = require("../utilis/kudiSmsHelper");
const { getCoordsFromAddress } = require("../utilis/delivery");

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
const generateOtp = (length = 4) => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};
// -------------------------------------

// controllers/authController.js
const register = async (req, res) => {
    try {
        // 'location' in req.body is the address string from the frontend
        const { name, role, location, phone, otpSession, operatingArea } = req.body;
        const decoded = jwt.verify(otpSession, process.env.JWT_SECRET);
        
        const finalEmail = decoded.email;
        const sessionPhone = decoded.phone; 
        const finalPhone = sessionPhone ? phone : null; 

        if (!name || (!finalEmail && !finalPhone)) { 
            return res.status(400).json({ error: "Missing required fields (name, email/phone)" });
        }
        
        if (sessionPhone && (!finalPhone || sessionPhone !== finalPhone)) {
            return res.status(400).json({ error: "Phone number mismatch." });
        }

        // --- FIXED GEOLOCATION LOGIC ---
        // 'location' here is the text address string (e.g., "123 Street, Ikeja")
        const geo = await getCoordsFromAddress(location);
        if (!geo) return res.status(400).json({ error: "Invalid address provided" });

        const coordinates = {
            type: "Point",
            coordinates: [geo.lng, geo.lat], // Google uses lng/lat, MongoDB uses [lng, lat]
        };

        // --- USER CREATION WITH BOTH STRING AND POINT ---
        let userProps = { 
            name, 
            email: finalEmail, 
            phone: finalPhone, 
            address: location, // SAVES THE STRING FOR PRICING
            location: coordinates // SAVES THE POINT FOR MAPS
        };

        let user;
        if (role === "customer") {
            user = new Customer(userProps);
        } else if (role === "vendor") {
            user = new Vendor(userProps);
        } else if (role === "rider") {
            user = new Rider({ ...userProps, operatingArea });
        } else {
            return res.status(400).json({ error: "Invalid role specified" });
        }
        
        await user.save();

        // Generate tokens (Assuming these helpers exist in your generateToken.js)
        const accessToken = generateAccessToken({ id: user._id, role: user.role });
        const refreshToken = generateRefreshToken({ id: user._id, role: user.role });
        await RefreshToken.create({ token: refreshToken, user: user._id, ip: req.ip });

        res.status(201).json({
            success: true,
            accessToken,
            refreshToken,
            user: { id: user._id, name: user.name, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error("Register Error:", err);
        return res.status(500).json({ error: err.message });
    }
};

const login = async (req, res) => {
    try {
        const { identifier } = req.body; // <-- RENAMED 'email' to 'identifier'
        if (!identifier) return res.status(400).json({ error: "Missing email or phone number" });

        let user;
        // Simple check to determine if the input is likely an email or a phone number
        if (identifier.includes('@')) {
            // Assume input is an email
            user = await User.findOne({ email: identifier });
        } else {
            // Assume input is a phone number
            user = await User.findOne({ phone: identifier });
        }

        if (!user) return res.status(400).json({ error: "Invalid credentials" });
        
        // --- OTP Generation and Sending Logic ---
        
        // Check if the user has an email to send the OTP to (Email is preferred/required for Nodemailer)
        if (user.email && identifier.includes('@')) {
            const otp = generateOtp(4);
            console.log(`Generated OTP: ${otp}`);
            // Note: We are using the user's registered email here, not the identifier input
            const newOtp = new OtpVerification({ email: user.email, otp }); 
            await newOtp.save();
        
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: user.email,
                subject: 'Login Verification OTP',
                html: `<p>Your login verification code for Ounje is:</p><h2 style="color: #007bff; text-align: center;">${otp}</h2>`,
            };
        
            try {
                await transporter.sendMail(mailOptions);
                // Return the email that the OTP was sent to
                return res.json({ message: `OTP Sent to email: ${user.email}` }); 
            } catch (mailError) {
                console.error("Nodemailer failed to send email during login:", mailError);
                return res.status(500).json({ error: "Failed to send OTP email." });
            }
        } else if (user.phone) {
            // Option 2: If the user only has a phone number, use KudiSMS for login OTP
            
            // 1. Call KudiSMS API to send OTP
            const { success, reference, error } = await requestSmsOtp(user.phone);

            if (success) {
                // 2. Temporarily save the KudiSMS reference
                const newVerification = new OtpVerification({ 
                    phone: user.phone, 
                    reference, 
                    isPhone: true 
                });
                await newVerification.save();
                
                // Return the phone number that the OTP was sent to
                return res.json({ "message": `OTP Sent to phone: ${user.phone}`, reference: reference });
            } else {
                console.error("KudiSMS error for login phone:", user.phone, error);
                return res.status(500).json({ error: error });
            }
        } else {
             // User exists but has neither email nor phone (shouldn't happen with current registration)
             return res.status(500).json({ error: "User profile incomplete. Cannot send OTP." });
        }


    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

const requestOtp = async (req, res) => {
  const { email } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ error: "Email already in use" });

  const otp = generateOtp(4); // <-- UPDATED
  console.log(`Generated OTP: ${otp}`);
  const newOtp = new OtpVerification({ email, otp });
  await newOtp.save();

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Email Verification OTP",
    html: `<p>Your registration verification code for Ounje is:</p><h2 style="color: #007bff; text-align: center;">${otp}</h2>`,
  };

  try {
    const response = await transporter.sendMail(mailOptions); // <-- UPDATED
    console.log(response);
    res.json({ message: "OTP Sent to email" });
  } catch (mailError) {
    console.error(
      "Nodemailer failed to send email during request-otp:",
      mailError
    );
    // Important: You may want to delete the saved OTP here if the email failed to prevent confusion
    res
      .status(500)
      .json({ error: "Failed to send OTP email. Check EMAIL_PASS." });
  }
};

const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  const record = await OtpVerification.findOne({ email, otp });
  if (!record) {
    return res.status(400).json({ success: false, message: "Invalid OTP" });
  }
  await OtpVerification.deleteMany({ email });

  const loginUser = await User.findOne({ email });
  if (loginUser) {
    const accessToken = generateAccessToken({
      id: loginUser._id,
      role: loginUser.role,
    });
    const refreshToken = generateRefreshToken({
      id: loginUser._id,
      role: loginUser.role,
    });

    await RefreshToken.create({
      token: refreshToken,
      user: loginUser._id,
      ip: req.ip,
    });

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: loginUser._id,
        name: loginUser.name,
        email: loginUser.email,
        role: loginUser.role,
      },
    });
  }
  const otpSession = jwt.sign({ email }, process.env.JWT_SECRET, {
    expiresIn: "30m",
  });
  res.json({ success: true, otpSession });
};

const logOut = async (req, res) => {
  const token = req.body.refreshToken;
  if (!token) return res.sendStatus(204);

  try {
    await RefreshToken.deleteOne({ token });
    res.json({ message: "Logged out successfully" });
  } catch {
    res.status(500).json({ message: "Logout failed" });
  }
};

const refresh = async (req, res) => {
  const token = req.body.refreshToken;
  if (!token)
    return res.status(401).json({ message: "Refresh token required" });

  const refreshExists = await RefreshToken.findOne({ token });
  if (!refreshExists)
    return res.status(403).json({ message: "Invalid refresh token" });
  try {
    const decoded = jwt.verify(token, process.env.REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "User not found" });

    const newAccessToken = generateAccessToken({
      id: user._id,
      role: user.role,
    });
    res.json({ accessToken: newAccessToken });
  } catch (err) {
    res.status(401).json({ message: err.message, name: err.name });
  }
};

// --- CONTROLLERS FOR PHONE OTP ---

const requestPhoneOtp = async(req,res) =>{
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Missing phone number" });

    const exists = await User.findOne({ phone });
    if (exists) return res.status(400).json({ error: "Phone number already in use" });
    
    // 1. Call KudiSMS API to send OTP
    const { success, reference, error } = await requestSmsOtp(phone);

    if (success) {
        // 2. Temporarily save the KudiSMS reference (needed for verification) 
        //    instead of saving the OTP itself (which KudiSMS manages).
        //    We reuse the OtpVerification model but store the phone and reference.
        const newVerification = new OtpVerification({ 
            phone, 
            reference, 
            isPhone: true // Add a flag to distinguish from email OTP
        });
        await newVerification.save();

        res.json({ "message": "OTP Sent to phone", reference: reference });
    } else {
        console.error("KudiSMS error for phone:", phone, error);
        res.status(500).json({ error: error });
    }
}

const verifyPhoneOtp = async(req,res) =>{
    const { phone, otp, reference } = req.body;
    // ... (Initial validation and localRecord check remains the same)

    const localRecord = await OtpVerification.findOne({ phone, reference, isPhone: true });
    if (!localRecord) {
        return res.status(400).json({ success: false, message: "Invalid verification session" });
    }

    // 2. Call KudiSMS API to verify OTP
    const { success, error } = await verifySmsOtp(otp, reference);

    if (success) {
        // Verification successful. Clean up the local session.
        await OtpVerification.deleteOne({ phone, reference, isPhone: true });
        
        // --- NEW LOGIN LOGIC ADDED HERE ---
        const loginUser = await User.findOne({ phone });
        if(loginUser){
            // This is a login flow
            const accessToken = generateAccessToken({id: loginUser._id, role: loginUser.role})
            const refreshToken = generateRefreshToken({id: loginUser._id, role: loginUser.role})

            await RefreshToken.create({ token: refreshToken, user: loginUser._id, ip: req.ip });
            
            return res.json({ 
                success: true, 
                accessToken, 
                refreshToken,
                user: { id: loginUser._id, name: loginUser.name, email: loginUser.email, role: loginUser.role } 
            });
        }
        // --- END NEW LOGIN LOGIC ---
        
        // 3. Generate a temporary session token (otpSession) containing the phone number (Registration flow)
        const otpSession = jwt.sign( { phone }, process.env.JWT_SECRET, { expiresIn: "30m" })
        res.json({ success: true, otpSession});
    } else {
        res.status(400).json({ success: false, message: error });
    }
}

module.exports = {
  register,
  login,
  requestOtp,
  verifyOtp,
  logOut,
  refresh,
  requestPhoneOtp,
  verifyPhoneOtp,
};
