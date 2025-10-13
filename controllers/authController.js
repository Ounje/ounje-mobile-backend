const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const NodemailerHelper = require('nodemailer-otp');
const OtpVerification = require("../models/OtpVerification");
const Customer = require("../models/Customer");
const Vendor = require("../models/Vendor");
const Rider = require("../models/Rider");
const helper = new NodemailerHelper(process.env.EMAIL_USER, process.env.EMAIL_PASS);



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
          user = new Customer({ name, email, phone, location,   });
        }else if(role === "vendor"){
          user = new Vendor({ name, email, phone, location, });
        }else if(role === "rider"){
          user = new Rider({ name, email, phone, location, operatingArea,  });
        }
        await user.save();
    
        const userSession = jwt.sign({id: user._id, role: user.role}, process.env.JWT_SECRET, {expiresIn: "1d"})
    
        return res.json({ message: "Registered successfully", user: { id: user._id, name: user.name, email: user.email, role: user.role }, userSession });
    }catch (err) {
        return res.status(500).json({ error: err.message });  
    }
}

const login = async(req,res) =>{
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Missing email" });
    
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "invalid credentials" });
    
        const otp = helper.generateOtp(4);
        console.log(`Generated OTP: ${otp}`);
        const newOtp = new OtpVerification({ email, otp });
        await newOtp.save();
        helper.sendEmail(email,'Email verification',`This is your otp verification code `, otp)
        .then((response ) => {
          console.log(response );
        })
        .catch((err) => {
          console.error(err);
        });
        res.json({"message": "OTP Sent to email"})
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

const requestOtp = async(req,res) =>{
    const { email } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already in use" });
    const otp = helper.generateOtp(4);
    const newOtp = new OtpVerification({ email, otp });
    await newOtp.save();
    helper.sendEmail(email,'Email verification',`This is your otp verification code `, otp)
    .then((response ) => {
    console.log(response );
    })
    .catch((err) => {
    console.error(err);
    });
    res.json({"message": "OTP Sent to email"})
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
    const userSession = jwt.sign( { id: loginUser._id, role: loginUser.role }, process.env.JWT_SECRET, { expiresIn: "1d" })
    return res.json({ success: true, userSession, user: { id: loginUser._id, name: loginUser.name, email: loginUser.email, role: loginUser.role } });
    }
    const otpSession = jwt.sign( { email }, process.env.JWT_SECRET, { expiresIn: "30m" })
    res.json({ success: true, otpSession});
}

module.exports = {
    register,
    login,
    requestOtp,
    verifyOtp,
}