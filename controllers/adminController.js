const { Admin, User, Customer, VendorProfile, RiderProfile } = require("../models");
const bcrypt = require("bcryptjs");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");

const createPlatformAccount = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            return res.status(400).json({ error: "Admin with this email already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = new Admin({ name, email, password: hashedPassword });
        await newAdmin.save();
        const accessToken = generateAccessToken({ id: newAdmin._id, role: "admin" });
        const refreshToken = generateRefreshToken({ id: newAdmin._id, role: "admin" });
        res.status(201).json({ message: "Platform admin account created successfully" });
    } catch (error) {
        console.error("Error creating platform account:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email }).select("+password");
        if (!admin) {
            return res.status(400).json({ error: "Invalid email or password" });
        }
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid email or password" });
        }
        const accessToken = generateAccessToken({ id: admin._id, role: "admin" });
        const refreshToken = generateRefreshToken({ id: admin._id, role: "admin" });
        res.json({ accessToken, refreshToken, admin: { name: admin.name, email: admin.email } });
    } catch (error) {
        console.error("Admin login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const users = await User.find({});
        
        const enrichedUsers = await Promise.all(
            users.map(async (user) => {
                const userObj = user.toJSON ? user.toJSON() : user;
                if (user.role === "customer") {
                    const customer = await Customer.findOne({ user: user._id }).lean();
                    userObj.customerDetails = customer || null;
                } else if (user.role === "vendor") {
                    const vendor = await VendorProfile.findOne({ name: user.name }).lean();
                    userObj.vendorDetails = vendor || null;
                } else if (user.role === "rider") {
                    const rider = await RiderProfile.findOne({ user: user._id }).lean();
                    userObj.riderDetails = rider || null;
                }
                return userObj;
            })
        );

        res.json({
            success: true,
            count: enrichedUsers.length,
            users: enrichedUsers
        });
    } catch (error) {
        console.error("Error fetching all users:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = { createPlatformAccount, adminLogin, getAllUsers };