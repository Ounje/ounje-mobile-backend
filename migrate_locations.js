const mongoose = require('mongoose');
require('./config/db'); // Connect to MongoDB
const VendorProfile = require('./models/VendorProfile'); // Use VendorProfile instead of Vendor

const migrate = async () => {
  try {
    // This finds all Vendors who don't have a 'location' field yet
    const vendorsToUpdate = await VendorProfile.find({
      $or: [
        { location: { $exists: false } },
        { "location.coordinates": { $size: 0 } }
      ]
    });

    console.log(`Found ${vendorsToUpdate.length} vendors needing location data.`);

    for (const vendor of vendorsToUpdate) {
      // Giving them a default coordinate (Lagos, Nigeria) 
      // so the distance math doesn't fail.
      vendor.location = {
        type: "Point",
        coordinates: [3.3792, 6.5244] // [longitude, latitude]
      };
      await vendor.save();
    }

    console.log("✅ Migration complete! All vendors now have coordinates.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
};

migrate();