const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const LedgerAccountSchema = new mongoose.Schema({}, { strict: false, collection: "ledgeraccounts" });
const LedgerEntrySchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "LedgerAccount" }
}, { strict: false, collection: "ledgerentries" });

const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);
const LedgerEntry = mongoose.model("LedgerEntry", LedgerEntrySchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    const accountId = new mongoose.Types.ObjectId("69ebe217af62f56bd93b5377");
    const acc = await LedgerAccount.findById(accountId).lean();
    console.log(`Current Dandy Ledger Account Balance: ${acc.availableBalance}`);

    const entries = await LedgerEntry.find({ accountId }).sort({ createdAt: 1 }).lean();
    console.log(`Analyzing ${entries.length} total entries...`);

    // Let's group entries by orderId or timestamp to find duplicates
    const seenOrders = {};
    let totalDuplicatesAmount = 0;
    const duplicates = [];

    for (const e of entries) {
      if (e.reason === "REFUND") {
        const orderKey = e.orderId ? e.orderId.toString() : e.createdAt.toISOString();
        if (seenOrders[orderKey]) {
          console.log(`Duplicate refund found! Entry ID: ${e._id} | Order: ${e.orderId} | Amount: ${e.amount} | Date: ${e.createdAt}`);
          totalDuplicatesAmount += e.amount;
          duplicates.push(e);
        } else {
          seenOrders[orderKey] = true;
        }
      }
    }

    console.log(`Total duplicate refunds sum: ${totalDuplicatesAmount}`);
    console.log(`Expected Correct Balance (Current - Duplicates): ${acc.availableBalance - totalDuplicatesAmount}`);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
