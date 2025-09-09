const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

// Register (customer/seller/rider)
router.post("/register", async (req, res) => {
  try {
    console.log(req.body);
    const { name, email, password, role, otpSession } = req.body;
    const decoded = jwt.verify(otpSession, process.env.JWT_SECRET);
    const phone = decoded.phone;
    console.log(decoded);
    if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed, role, phone });
    await user.save();

    return res.json({ message: "Registered successfully", user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
    return res.status(401).json({ error: "OTP session expired" });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/request-otp", async (req, res) =>{
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = require('twilio')(accountSid, authToken);

  client.verify.v2.services(process.env.TWILIO_VERIFIED_SID)
        .verifications
        .create({to: '+2347030171460', channel: 'sms'})
        .then(verification => console.log(verification.sid));
  res.json({"message": "OTP Sent"})
})

router.post("/verify-otp", async (req, res) =>{
  const { code } = req.body; // user submits phone & OTP code
  const accountSid = process.env.TWILIO_ACCOUNT_SID;  
  const authToken = process.env.TWILIO_AUTH_TOKEN;  
  const client = require('twilio')(accountSid, authToken);

  try {
    const verificationCheck = await client.verify.v2.services(process.env.TWILIO_VERIFIED_SID)
      .verificationChecks
      .create({ to: "+2347030171460", code});

    if (verificationCheck.status === "approved") {
      // ✅ OTP is correct
      const otpSession = jwt.sign( { phone: "+2347030171460" }, process.env.JWT_SECRET, { expiresIn: "2m" })
      res.json({ success: true, otpSession});
    } else {
      // ❌ OTP is invalid or expired
      res.status(400).json({ success: false, message: "Invalid OTP" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}) 


module.exports = router;
