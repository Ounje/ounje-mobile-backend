const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http"); // Standard Node.js module
require("dotenv").config();
const httpLogger = require("./middleware/httpLogger");
const logger = require("./utils/logger");

// Load all models early so Mongoose model registration is guaranteed
require("./models");

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

// This is the "server" variable that was missing!
const server = http.createServer(app);

// Initialize Socket.io using that server
const io = require("socket.io")(server, {
	cors: { origin: "*" }, // Allows connections from your frontend
});

// ✅ FIX: Set global.io OUTSIDE the connection handler
// This makes it available to all services (notification, order, etc.)
global.io = io;
logger.info("✅ Socket.IO initialized and available globally");

app.use(httpLogger); // HTTP Request Logging
app.use(cors());
app.use(express.json());
app.set("trust proxy", 1);

// Swagger Documentation
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./config/swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

//api routes
app.use("/api/auth", authRoutes);
// Standardized routes
app.use("/api/food-items", foodItemRoutes);
app.use("/api/combos", comboRoutes);
// Legacy route support (Redirect /api/dishes/xxx to the appropriate new route if we wanted, but simple mounting is okay)
// For legacy /api/dishes/food-items -> it won't work easily with standard mounting unless we duplicate logic.
// But verified legacy use cases: /api/dishes/food-items -> now /api/food-items
// /api/dishes/combos -> now /api/combos
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
// app.use("/api/test", require("./tests/test01"));

logger.info(`Frontend URL: ${process.env.FRONTEND_URL}`);

// Socket.IO Connection Handler
io.on("connection", async (socket) => {
	logger.info(`A user connected: ${socket.id}`);

	// Auto-join rooms on connect using the auth token so emits reach the right socket
	// regardless of whether the client sends a manual "join" event.
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

			// Join VendorProfile and RiderProfile rooms so backend can emit to profile IDs
			const { VendorProfile, RiderProfile } = require("./models");

			const [vendor, rider] = await Promise.all([
				VendorProfile.findOne({ owner: userId }).select("_id").lean(),
				RiderProfile.findOne({ user: userId }).select("_id status isActive operatingArea").lean(),
			]);

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
		// Unauthenticated socket — fine, public connection
	}

	// Keep manual join handler for backward compatibility
	socket.on("join", async (userId) => {
		socket.join(userId);
		logger.info(`User ${userId} joined their private room`);

		// Auto-join Customer profile room
		try {
			const { Customer, VendorProfile, RiderProfile } = require("./models");

			const customer = await Customer.findOne({ user: userId }).select("_id").lean();
			if (customer) {
				socket.join(customer._id.toString());
				logger.info(`Socket auto-joined customerProfile room: ${customer._id}`);
			}

			const vendor = await VendorProfile.findOne({ owner: userId }).select("_id").lean();
			if (vendor) {
				socket.join(vendor._id.toString());
				logger.info(`Socket auto-joined vendorProfile room: ${vendor._id}`);
			}

			const rider = await RiderProfile.findOne({ user: userId }).select("_id").lean();
			if (rider) {
				socket.join(rider._id.toString());
				logger.info(`Socket auto-joined riderProfile room: ${rider._id}`);
			}
		} catch (err) {
			logger.error(`Auto-join profile room failed: ${err.message}`);
		}
	});

	// 1. Listen for the 'update-location' signal from the Rider's App
	socket.on("update-location", async (data) => {
		try {
			const { RiderProfile } = require("./models");

			// 2. SAVE to Database: Update rider location
			// Note: data.riderId should be the rider's user ID, not the profile ID
			await RiderProfile.findOneAndUpdate(
				{ user: data.riderId },
				{
					currentLocation: {
						type: "Point",
						coordinates: [data.lng, data.lat], // GeoJSON format: [longitude, latitude]
					},
				},
			);

			logger.info(
				`Rider ${data.riderId} location updated: [${data.lng}, ${data.lat}]`,
			);

			// 3. BROADCAST: Send this same data to the Operations Dashboard
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

// Middleware
const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler);

app.get("/", (req, res) => res.send("Food Service API running 🚀"));

const PORT = process.env.PORT || 5000;
const keepAlive = require("./utils/keepAlive");

mongoose.connect(process.env.MONGO_DB_URI).then(() => {
	logger.info("✅ MongoDB connected");
	server.listen(PORT, () => {
		logger.info(`🚀 Server running on port ${PORT}`);

		// Keep Render instance awake by pinging itself every 14 minutes
		if (process.env.NODE_ENV === "production" || process.env.RENDER) {
			keepAlive("https://ounje-mobile-backend.onrender.com/");
		}
	});
});
