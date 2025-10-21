const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: "No authorization header" });

    const token = header.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    let payload;
      payload = jwt.verify(token, process.env.JWT_SECRET)

    req.user = payload;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
          return res.status(401).json({ message: "Token expired" });
        }
    return res.status(401).json({ error: "Unauthorized", details: err.message });
  }
};

const roleGuard = (allowedRoles = []) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "No user in request" });
  if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden: insufficient role" });
  next();
};

module.exports = { authMiddleware, roleGuard };
