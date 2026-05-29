const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const LedgerEntrySchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerAccount" }
}, { strict: false, collection: "ledgerentries" });
const LedgerEntry = mongoose.model("LedgerEntry", LedgerEntrySchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    const entries = await LedgerEntry.find({ accountId: new mongoose.Types.ObjectId("69ebe217af62f56bd93b5377") }).sort({ createdAt: -1 }).limit(30).lean();
    console.log(`Found ${entries.length} recent entries for Dandy's customer ledger account:`);
    for (const e of entries) {
      console.log(`- ID: ${e._id} | Amount: ${e.amount} | Type: ${e.entryType} | Reason: ${e.reason} | Date: ${e.createdAt} | BalanceAfter: ${e.balanceAfter}`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
