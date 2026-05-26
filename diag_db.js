const mongoose = require("mongoose");
require("dotenv").config();

async function checkSub() {
    const dbUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;
    console.log("DB URI FOUND:", dbUri ? "YES" : "NO");
    if (!dbUri) return;

    try {
        await mongoose.connect(dbUri);
        const dbName = mongoose.connection.name;
        console.log("CONNECTED TO DATABASE:", dbName);
        
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log("COLLECTIONS IN THIS DB:", collections.map(c => c.name).join(", "));
        
        const Promo = mongoose.connection.db.collection("promotions");
        const count = await Promo.countDocuments({ isDeleted: false });
        console.log("PROMOTIONS COUNT (not deleted):", count);
        
        const codes = await Promo.find({ isDeleted: false }).limit(5).toArray();
        console.log("LATEST 5 PROMO CODES:", codes.map(c => c.code).join(", "));
        
    } catch (err) {
        console.error("DIAGNOSTIC ERROR:", err);
    } finally {
        await mongoose.disconnect();
    }
}

checkSub();
