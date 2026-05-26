const mongoose = require("mongoose");
require("dotenv").config();
require("./models");
const { User, Customer, RiderProfile, VendorProfile } = require("./models");

async function main() {
  const dbUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;
  if (!dbUri) {
    console.error("Error: Neither MONGO_DB_URI nor MONGO_URI is set in your .env file!");
    process.exit(1);
  }
  
  console.log("Connecting to DB...");
  await mongoose.connect(dbUri);
  console.log("Connected successfully!\n");

  const users = await User.find({});
  console.log(`=========================================`);
  console.log(`TOTAL SIGNED-UP USERS: ${users.length}`);
  console.log(`=========================================\n`);

  for (const user of users) {
    console.log("-----------------------------------------");
    console.log(`Name:   ${user.name}`);
    console.log(`Role:   ${user.role.toUpperCase()}`);
    console.log(`Phone:  ${user.phone || "N/A"}`);
    console.log(`Email:  ${user.email || "N/A"}`);
    console.log(`Addr:   ${user.address || "N/A"}`);
    
    // Fetch extra details based on their role
    if (user.role === "customer") {
      const customer = await Customer.findOne({ user: user._id });
      if (customer) {
        console.log(`Rank:   ${customer.rank}`);
        console.log(`Active: ${customer.isActive}`);
      }
    } else if (user.role === "vendor") {
      const vendor = await VendorProfile.findOne({ name: user.name }); // or link field if applicable
      if (vendor) {
        console.log(`Store:  ${vendor.storeDetails?.[0]?.storeName || "N/A"}`);
        console.log(`Status: ${vendor.storeDetails?.[0]?.status || "N/A"}`);
      }
    } else if (user.role === "rider") {
      const rider = await RiderProfile.findOne({ user: user._id });
      if (rider) {
        console.log(`Vehicle:${rider.vehicleType || "N/A"}`);
        console.log(`Status: ${rider.status || "N/A"}`);
      }
    }
  }

  await mongoose.disconnect();
  console.log("\nDone!");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
