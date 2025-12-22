const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http"); // Standard Node.js module
require("dotenv").config();
const authRoutes = require("./routes/authRoutes");
const dishRoutes = require("./routes/dishRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const customerRoutes = require("./routes/customerRoutes");
const plateRoutes = require("./routes/plateRoutes");
const riderRoutes = require('./routes/riderRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');

const app = express();

// This is the "server" variable that was missing!
const server = http.createServer(app);

// Initialize Socket.io using that server
const io = require('socket.io')(server, {
    cors: { origin: "*" } // Allows connections from your frontend
});

app.use(cors());
app.use(express.json());
//api routes
app.use("/api/auth", authRoutes);
app.use("/api/food", dishRoutes);
app.use("/api/dishes", dishRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/plates", plateRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/delivery', deliveryRoutes)
// app.use("/api/test", require("./routes/testRoutes"));


console.log(process.env.FRONTEND_URL)


io.on('connection', (socket) => {
  
  // 1. Listen for the 'update-location' signal from the Rider's App
  socket.on('update-location', async (data) => {
    try {
      // 2. SAVE to Database: This is where you apply the code
      // We update the specific rider using their ID
      await RiderModel.findByIdAndUpdate(data.riderId, {
        lastKnownLocation: { 
          lat: data.lat, 
          lng: data.lng 
        },
        updatedAt: new Date()
      });

      // 3. BROADCAST: Send this same data to the Operations Dashboard
      // This tells the dashboard to move the rider's icon on the map
      io.emit('rider-moved', {
        riderId: data.riderId,
        lat: data.lat,
        lng: data.lng
      });

    } catch (error) {
      console.error("Database update failed:", error);
    }
  });
});

// Middleware



app.get("/", (req, res) => res.send("Food Service API running 🚀"));

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_DB_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`)); // CORRECT
  })
  
