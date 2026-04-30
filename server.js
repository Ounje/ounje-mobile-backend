const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const cron = require("node-cron");
const { processAllPendingPayouts } = require("./jobs/payoutProcessor");
require("dotenv").config();

const httpLogger = require("./middleware/httpLogger");
const logger = require("./utils/logger");

// Load models early
require("./models");

// Firebase init
require("./utils/firebase");

// Routes
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

// Socket.io
const io = require("socket.io")(server, {
	cors: { origin: "*" },
});

global.io = io;

logger.info("[SOCKET] initialized");

// Middleware
app.use(httpLogger);
app.use(cors());

// Webhooks BEFORE JSON parser
app.use("/api/webhooks", require("./routes/webhookRoutes"));

app.use(express.json());
app.set("trust proxy", 1);

// Swagger
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./config/swagger");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Routes
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

// Deep link fallback
app.get("/VendorMenu/:id", (req, res) => {
	const ua = req.headers["user-agent"] || "";
	const playStore =
		"https://play.google.com/store/apps/details?id=com.ounjefood.Ounje";
	const appStore = "https://apps.apple.com/app/ounje/id6762204959";

	if (/android/i.test(ua)) return res.redirect(302, playStore);
	if (/iphone|ipad|ipod/i.test(ua)) return res.redirect(302, appStore);

	return res.send("Download Ounje App");
});

// ─────────────────────────────────────────────
// CRON JOB (SAFE WITH LOCK)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// CRON JOB — Process queued withdrawals
// Runs every 15 minutes.
// Picks up withdrawals whose 2-hour hold has elapsed and fires Paystack transfers.
// ─────────────────────────────────────────────

let isProcessingPayouts = false;

cron.schedule(
	"*/15 * * * *",
	async () => {
		if (isProcessingPayouts) {
			logger.warn("[CRON] Skipped — previous run still in progress");
			return;
		}

		isProcessingPayouts = true;
		logger.info("[CRON] Withdrawal processor triggered");

		try {
			await processAllPendingPayouts();
			logger.info("[CRON] Withdrawal processor completed");
		} catch (err) {
			logger.error("[CRON] Withdrawal processor error", {
				message: err.message,
			});
		} finally {
			isProcessingPayouts = false;
		}
	},
	{ timezone: "Africa/Lagos" },
);

// ─────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────

io.on("connection", async (socket) => {
	logger.info("[SOCKET] user connected", {
		socketId: socket.id,
	});

	try {
		const jwt = require("jsonwebtoken");
		const decoded = jwt.verify(
			socket.handshake.auth.token,
			process.env.ACCESS_SECRET,
		);

		const userId = decoded.id;

		if (userId) {
			socket.join(userId);

			logger.info("[SOCKET] user room joined", {
				userId,
				socketId: socket.id,
			});

			const { Customer, VendorProfile, RiderProfile } = require("./models");

			const [customer, vendor, rider] = await Promise.all([
				Customer.findOne({ user: userId }).select("_id").lean(),
				VendorProfile.findOne({ owner: userId }).select("_id").lean(),
				RiderProfile.findOne({ user: userId }).select("_id status").lean(),
			]);

			if (customer) socket.join(customer._id.toString());
			if (vendor) socket.join(vendor._id.toString());
			if (rider) socket.join(rider._id.toString());
		}
	} catch {
		// ignore unauthenticated sockets
	}

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

			logger.info("[SOCKET] rider location updated", {
				riderId: data.riderId,
				coordinates: [data.lng, data.lat],
			});

			io.emit("rider-moved", data);
		} catch (err) {
			logger.error("[SOCKET] location update failed", {
				error: err.message,
			});
		}
	});

	socket.on("disconnect", () => {
		logger.info("[SOCKET] user disconnected", {
			socketId: socket.id,
		});
	});
});

// ─────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────

const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler);

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────

app.get("/", (req, res) => {
	res.send("Food Service API running 🚀");
});

// ─────────────────────────────────────────────
// DB + SERVER START
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
const keepAlive = require("./utils/keepAlive");

mongoose
	.connect(process.env.MONGO_DB_URI)
	.then(() => {
		logger.info("[DB] MongoDB connected");

		server.listen(PORT, () => {
			logger.info("[SERVER] started", {
				port: PORT,
				env: process.env.NODE_ENV,
			});

			if (process.env.NODE_ENV === "production" || process.env.RENDER) {
				keepAlive("https://ounje-mobile-backend.onrender.com/");
			}
		});
	})
	.catch((err) => {
		logger.error("[DB] connection failed", {
			error: err.message,
		});

		process.exit(1);
	});
