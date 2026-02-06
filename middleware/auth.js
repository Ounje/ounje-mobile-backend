const jwt = require("jsonwebtoken");
const { Customer } = require("../models");

const authMiddleware = async (req, res, next) => {
	try {
		const header = req.headers.authorization;
		if (!header)
			return res.status(401).json({ error: "No authorization header" });

		const token = header.split(" ")[1];
		if (!token) return res.status(401).json({ error: "No token provided" });

		let payload;
		payload = jwt.verify(token, process.env.ACCESS_SECRET);

		req.user = payload;
		next();
	} catch (err) {
		if (err.name === "TokenExpiredError") {
			return res.status(401).json({ message: "Token expired" });
		}
		return res
			.status(401)
			.json({ error: "Unauthorized", details: err.message });
	}
};

const roleGuard =
	(allowedRoles = []) =>
	(req, res, next) => {
		if (!req.user) return res.status(401).json({ error: "No user in request" });
		if (!allowedRoles.includes(req.user.role))
			return res.status(403).json({ error: "Forbidden: insufficient role" });
		next();
	};

const checkActiveCustomer = async (req, res, next) => {
	try {
		const customerId = req.user.id;
		const customer = await Customer.findById(customerId);
		if (!customer) {
			return res.status(404).json({ error: "Customer not found" });
		} else if (customer.accountStatus !== "active") {
			return res.status(403).json({
				error: "Customer account is not active.Please contact support.",
			});
		}
		next();
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "Internal server error" });
	}
};

const ipWhitelist =
	(allowedIps = []) =>
	(req, res, next) => {
		console.log("Request IP:", req.ip);
		let requestIp = req.ip || req.connection.remoteAddress;
		if (requestIp.startsWith("::ffff:")) {
			requestIp = requestIp.replace("::ffff:", "");
		}

		if (!allowedIps.includes(requestIp)) {
			return res
				.status(403)
				.json({ error: "Forbidden: IP not allowed", requestIp });
		}

		next();
	};

module.exports = {
	authMiddleware,
	roleGuard,
	ipWhitelist,
	checkActiveCustomer,
};
