const mongoose = require("mongoose");
require("dotenv").config();
require("./models");
const { VendorProfile } = require("./models");

async function main() {
  console.log("Connecting to DB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected!");

  const vendors = await VendorProfile.find({});
  console.log(`Found ${vendors.length} vendors in DB:\n`);
  
  vendors.forEach(v => {
    console.log("-----------------------------------------");
    console.log(`ID: ${v._id}`);
    console.log(`Name: ${v.name}`);
    console.log(`IsActive: ${v.isActive}`);
    console.log(`Zone: ${v.zone}`);
    console.log(`Address: ${v.location?.address}`);
    console.log(`Coordinates: ${JSON.stringify(v.location?.coordinates)}`);
    console.log(`Store Status: ${v.storeDetails?.[0]?.status}`);
    console.log(`Store Name: ${v.storeDetails?.[0]?.storeName}`);
  });

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
