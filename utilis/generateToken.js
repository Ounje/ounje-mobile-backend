const jwt = require("jsonwebtoken");


const generateAccessToken = (payload) =>{
    const accessToken = jwt.sign({payload}, process.env.ACCESS_SECRET, { expiresIn: "1d" });
    return accessToken;
}

const generateRefreshToken = (payload) =>{
    const refreshToken = jwt.sign({payload}, process.env.REFRESH_SECRET, { expiresIn: "30d" });
    return refreshToken;
}


module.exports = {
    generateAccessToken,
    generateRefreshToken,
}