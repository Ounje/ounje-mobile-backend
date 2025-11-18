const jwt = require("jsonwebtoken");


const generateAccessToken = (payload) =>{
    // Using JWT_SECRET to match the .env file
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1d" }); // Changed to JWT_SECRET
    return accessToken;
}


const generateRefreshToken = (payload) =>{
    // REFRESH_SECRET is correct here
    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, { expiresIn: "7d" }); // Reduced expiration for safety
    return refreshToken;
}


module.exports = {
    generateAccessToken,
    generateRefreshToken,
}