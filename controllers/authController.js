// controllers/authController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer"); // <-- NEW IMPORT
const User = require("../models/User");
// const NodemailerHelper = require('nodemailer-otp'); // <-- REMOVED/COMMENTED OUT
const OtpVerification = require("../models/OtpVerification");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const Rider = require("../models/Rider");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");
const RefreshToken = require("../models/RefreshToken");
// const helper = new NodemailerHelper(process.env.EMAIL_USER, process.env.EMAIL_PASS);


// --- NEW NODEMAILER & OTP HELPERS ---

// 1. Nodemailer Transporter
const transporter = nodemailer.createTransport({
    // Using Gmail is common, but you must use an App Password for EMAIL_PASS
    service: 'gmail', 
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


const register = async(req,res) =>{
  try {
    const { name, role, location, phone, otpSession, operatingArea} = req.body;
    const decoded = jwt.verify(otpSession, process.env.JWT_SECRET);
    const email = decoded.email;
    if (!name || !email) return res.status(400).json({ error: "Missing fields" });
  
    const emailExists = await User.findOne({ email })
    if(emailExists) return res.status(400).json({error: "Email already in use"});
  
    const phoneExists = await User.findOne({ phone });
    if (phoneExists) return res.status(400).json({ error: "Phone number already in use" });
  
    let user;
    if(role === "customer"){
     user = new Customer({ name, email, phone, location,  });
    }else if(role === "vendor"){
     user = new Vendor({ name, email, phone, location, });
    }else if(role === "rider"){
     user = new Rider({ name, email, phone, location, operatingArea, });
    }
    await user.save();
 
    const accessToken = generateAccessToken({id: user._id, role: user.role})
    const refreshToken = generateRefreshToken({id: user._id, role: user.role})

    await RefreshToken.create({ token: refreshToken, user: user._id, ip: req.ip });
    
    
    return res.json({ message: "Registered successfully", user: { id: user._id, name: user.name, email: user.email, role: user.role }, accessToken, refreshToken });
  }catch (err) {
    // Log the error to see if it's a JWT error
        console.error("Registration error:", err);
    return res.status(500).json({ error: err.message }); 
  }
}

const login = async(req,res) =>{
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });
  
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "invalid credentials" });
  
    const otp = generateOtp(4); // <-- UPDATED
    console.log(`Generated OTP: ${otp}`);
    const newOtp = new OtpVerification({ email, otp });
    await newOtp.save();
  
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Login Verification OTP',
            html: `<p>Your login verification code for Ounje is:</p><h2 style="color: #007bff; text-align: center;">${otp}</h2>`,
        };

        try {
            const response = await transporter.sendMail(mailOptions); // <-- UPDATED
            console.log(response);
            res.json({ "message": "OTP Sent to email" });
        } catch (mailError) {
            console.error("Nodemailer failed to send email during login:", mailError);
            res.status(500).json({ error: "Failed to send OTP email." });
        }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

const requestOtp = async(req,res) =>{
  const { email } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ error: "Email already in use" });
  
  const otp = generateOtp(4); // <-- UPDATED
  const newOtp = new OtpVerification({ email, otp });
  await newOtp.save();
  
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Email Verification OTP',
        html: `<p>Your registration verification code for Ounje is:</p><h2 style="color: #007bff; text-align: center;">${otp}</h2>`,
    };

    try {
        const response = await transporter.sendMail(mailOptions); // <-- UPDATED
        console.log(response);
        res.json({ "message": "OTP Sent to email" });
    } catch (mailError) {
        console.error("Nodemailer failed to send email during request-otp:", mailError);
        // Important: You may want to delete the saved OTP here if the email failed to prevent confusion
        res.status(500).json({ error: "Failed to send OTP email. Check EMAIL_PASS." });
    }
}

const verifyOtp = async(req,res) =>{
  const { email, otp } = req.body;
  const record = await OtpVerification.findOne({ email, otp });
  if (!record) {
  return res.status(400).json({ success: false, message: "Invalid OTP" });
  }
  await OtpVerification.deleteMany({ email }); 


  const loginUser = await User.findOne({ email });
  if(loginUser){
   const accessToken = generateAccessToken({id: loginUser._id, role: loginUser.role})
   const refreshToken = generateRefreshToken({id: loginUser._id, role: loginUser.role})

   await RefreshToken.create({ token: refreshToken, user: loginUser._id, ip: req.ip });
   
  return res.json({ success: true, accessToken, refreshToken ,user: { id: loginUser._id, name: loginUser.name, email: loginUser.email, role: loginUser.role } });
  }
  const otpSession = jwt.sign( { email }, process.env.JWT_SECRET, { expiresIn: "30m" })
  res.json({ success: true, otpSession});
}

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

const refresh = async (req, res) =>{
 const token = req.body.refreshToken;
 if (!token) return res.status(401).json({ message: "Refresh token required" });

 const refreshExists = await RefreshToken.findOne({ token });
 if (!refreshExists) return res.status(403).json({ message: "Invalid refresh token" });
 try{
  const decoded = jwt.verify(token, process.env.REFRESH_SECRET);
  const user = await User.findById(decoded.id);
  if (!user) return res.status(401).json({ message: "User not found" });

  const newAccessToken = generateAccessToken({ id: user._id, role: user.role });
  res.json({ accessToken: newAccessToken });
 } catch (err) {
  res.status(401).json({ message: err.message , name: err.name});
 }
}

module.exports = {
  register,
  login,
  requestOtp,
  verifyOtp,
  logOut,
  refresh,
}