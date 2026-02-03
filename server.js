const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http"); // Standard Node.js module
require("dotenv").config();
const httpLogger = require("./middleware/httpLogger");
const logger = require("./utilis/logger");

// Load all models early so Mongoose model registration is guaranteed
require("./models");

const authRoutes = require("./routes/authRoutes");
const dishRoutes = require("./routes/dishRoutes");
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

const app = express();

// This is the "server" variable that was missing!
const server = http.createServer(app);

// Initialize Socket.io using that server
const io = require("socket.io")(server, {
	cors: { origin: "*" }, // Allows connections from your frontend
});

app.use(httpLogger); // HTTP Request Logging
app.use(cors());
app.use(express.json());
app.set("trust proxy", 1);

// Swagger Documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));
//api routes
app.use("/api/auth", authRoutes);
//app.use("/api/food", dishRoutes);
app.use("/api/dishes", dishRoutes);
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
// app.use("/api/test", require("./tests/test01"));

logger.info(`Frontend URL: ${process.env.FRONTEND_URL}`);

io.on("connection", (socket) => {
	// Make io reachable from controllers via `global.io` for simple emit (used for OTP push)
	global.io = io;
	logger.info(`A user connected: ${socket.id}`);

	// The Frontend will call this as soon as the app opens
	socket.on("join", (userId) => {
		socket.join(userId);
		logger.info(`User ${userId} joined their private room`);
	});

	// 1. Listen for the 'update-location' signal from the Rider's App
	socket.on("update-location", async (data) => {
		try {
			// 2. SAVE to Database: This is where you apply the code
			// We update the specific rider using their ID
			await RiderModel.findByIdAndUpdate(data.riderId, {
				lastKnownLocation: {
					lat: data.lat,
					lng: data.lng,
				},
				updatedAt: new Date(),
			});

			// 3. BROADCAST: Send this same data to the Operations Dashboard
			// This tells the dashboard to move the rider's icon on the map
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
		logger.info("User disconnected");
	});
});

// Middleware
const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler);

app.get("/", (req, res) => res.send("Food Service API running 🚀"));

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_DB_URI).then(() => {
	logger.info("✅ MongoDB connected");
	server.listen(PORT, () => logger.info(`🚀 Server running on port ${PORT}`)); // CORRECT
});



