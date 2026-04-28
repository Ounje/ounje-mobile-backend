const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
require("dotenv").config();
console.log("Resend Key present:", !!process.env.RESEND_API_KEY);
const httpLogger = require("./middleware/httpLogger");
const logger = require("./utils/logger");

// Load all models early so Mongoose model registration is guaranteed
require("./models");

// Initialize Firebase Admin SDK early so push notifications are ready before any request
require("./utils/firebase");

const authRoutes = require("./routes/authRoutes");
const foodItemRoutes = require("./routes/foodItemRoutes");
const comboRoutes = require("./routes/comboRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const customerRoutes = require("./routes/customerRoutes");
const plateRoutes = require("./routes/plateRoutes");
const riderRoutes = require("./routes/riderRoutes");
const payoutRoutes = require("./routes/payoutRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const supportRoutes = require("./routes/supportRoutes");
const ratingRouter = require("./routes/ratingsRoutes");
const newflashRouter = require("./routes/newflash.route");
const searchRouter = require("./routes/search.routes");
const notificationRouter = require("./routes/notification.router");
const promoRouter = require("./routes/promo.routes");

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = require("socket.io")(server, {
	cors: { origin: "*" },
});

global.io = io;
logger.info("✅ Socket.IO initialized and available globally");

app.use(httpLogger);
app.use(cors());

// ── Webhook route MUST be before express.json() ───────────────────────────────
// express.raw() captures the raw buffer Paystack needs for signature verification.
// If express.json() runs first, the raw body is gone and the sig check fails.
app.use("/api/webhooks", require("./routes/webhookRoutes"));

// ── Global JSON parser (all other routes) ────────────────────────────────────
app.use(express.json());
app.set("trust proxy", 1);

// Swagger Documentation
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./config/swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/food-items", foodItemRoutes);
app.use("/api/combos", comboRoutes);
app.use("/api/newsflash", newflashRouter);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/plates", plateRoutes);
app.use("/api/riders", riderRoutes);
app.use("/api/payouts", payoutRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/rating", ratingRouter);
app.use("/api/search", searchRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/promo", promoRouter);
app.use("/api/announcements", require("./routes/announcementRoutes"));
app.use("/api/finance", require("./routes/financeRoutes"));
app.use("/api/dva", require("./routes/dvaRoutes"));

// ── Deep-link fallback ────────────────────────────────────────────────────────
// When someone taps a share link (https://ounje.app/VendorMenu/:id) on a device
// that doesn't have the app installed, this route sends them to the right store.
app.get("/VendorMenu/:id", (req, res) => {
	const ua = req.headers["user-agent"] || "";
	const playStore = "https://play.google.com/store/apps/details?id=com.ounjefood.Ounje";
	const appStore = "https://apps.apple.com/app/ounje/id6762204959";
	if (/android/i.test(ua)) return res.redirect(302, playStore);
	if (/iphone|ipad|ipod/i.test(ua)) return res.redirect(302, appStore);
	// Desktop or unknown — show both options
	return res.send(`
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8">
			<meta name="viewport" content="width=device-width,initial-scale=1">
			<title>Download Ounje</title>
			<style>
				body { font-family: sans-serif; display: flex; flex-direction: column;
					   align-items: center; justify-content: center; min-height: 100vh;
					   margin: 0; background: #F0FDF4; color: #1A3F1C; }
				h1 { font-size: 1.5rem; margin-bottom: 8px; }
				p { color: #555; margin-bottom: 32px; }
				.links { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
				a { background: #1A3F1C; color: #fff; text-decoration: none;
					padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 1rem; }
			</style>
		</head>
		<body>
			<h1>Get the Ounje app</h1>
			<p>Download Ounje to view this vendor's menu and order food.</p>
			<div class="links">
				<a href="${playStore}">Google Play</a>
				<a href="${appStore}">App Store</a>
			</div>
		</body>
		</html>
	`);
});

logger.info(`Frontend URL: ${process.env.FRONTEND_URL}`);

// Socket.IO Connection Handler
io.on("connection", async (socket) => {
	logger.info(`A user connected: ${socket.id}`);

	try {
		const jwt = require("jsonwebtoken");
		const decoded = jwt.verify(
			socket.handshake.auth.token,
			process.env.ACCESS_SECRET,
		);
		const userId = decoded.id;
		if (userId) {
			socket.join(userId);
			logger.info(`Socket auto-joined userId room: ${userId}`);

			const { Customer, VendorProfile, RiderProfile } = require("./models");

			const [customer, vendor, rider] = await Promise.all([
				Customer.findOne({ user: userId }).select("_id").lean(),
				VendorProfile.findOne({ owner: userId }).select("_id").lean(),
				RiderProfile.findOne({ user: userId })
					.select("_id status isActive operatingArea")
					.lean(),
			]);

			if (customer) {
				socket.join(customer._id.toString());
				logger.info(`Socket auto-joined customerProfile room: ${customer._id}`);
			}
			if (vendor) {
				socket.join(vendor._id.toString());
				logger.info(`Socket auto-joined vendorProfile room: ${vendor._id}`);
			}
			if (rider) {
				socket.join(rider._id.toString());
				logger.info(
					`Socket auto-joined riderProfile room: ${rider._id} | status=${rider.status} isActive=${rider.isActive} zones=${JSON.stringify(rider.operatingArea)}`,
				);
			}
		}
	} catch {
		// Unauthenticated socket — fine
	}

	socket.on("join", async (userId) => {
		socket.join(userId);
		logger.info(`User ${userId} joined their private room`);

		try {
			const { Customer, VendorProfile, RiderProfile } = require("./models");

			const customer = await Customer.findOne({ user: userId })
				.select("_id")
				.lean();
			if (customer) {
				socket.join(customer._id.toString());
				logger.info(`Socket auto-joined customerProfile room: ${customer._id}`);
			}

			const vendor = await VendorProfile.findOne({ owner: userId })
				.select("_id")
				.lean();
			if (vendor) {
				socket.join(vendor._id.toString());
				logger.info(`Socket auto-joined vendorProfile room: ${vendor._id}`);
			}

			const rider = await RiderProfile.findOne({ user: userId })
				.select("_id")
				.lean();
			if (rider) {
				socket.join(rider._id.toString());
				logger.info(`Socket auto-joined riderProfile room: ${rider._id}`);
			}
		} catch (err) {
			logger.error(`Auto-join profile room failed: ${err.message}`);
		}
	});

	socket.on("update-location", async (data) => {
		try {
			const { RiderProfile } = require("./models");

			await RiderProfile.findOneAndUpdate(
				{ user: data.riderId },
				{
					currentLocation: {
						type: "Point",
						coordinates: [data.lng, data.lat],
					},
				},
			);

			logger.info(
				`Rider ${data.riderId} location updated: [${data.lng}, ${data.lat}]`,
			);

			io.emit("rider-moved", {
				riderId: data.riderId,
				lat: data.lat,
				lng: data.lng,
			});
		} catch (error) {
			logger.error(`Database update failed: ${error.message}`);
		}
	});

	socket.on("disconnect", () => {
		logger.info(`User disconnected: ${socket.id}`);
	});
});

const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler);

app.get("/", (req, res) => res.send("Food Service API running 🚀"));

const PORT = process.env.PORT || 5000;
const keepAlive = require("./utils/keepAlive");

mongoose.connect(process.env.MONGO_DB_URI).then(() => {
	logger.info("✅ MongoDB connected");
	server.listen(PORT, () => {
		logger.info(`🚀 Server running on port ${PORT}`);

		if (process.env.NODE_ENV === "production" || process.env.RENDER) {
			keepAlive("https://ounje-mobile-backend.onrender.com/");
		}
	});
});
