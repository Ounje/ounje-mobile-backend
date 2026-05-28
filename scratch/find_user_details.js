const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const UserSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const LedgerAccountSchema = new mongoose.Schema({}, { strict: false, collection: "ledgeraccounts" });
const LedgerEntrySchema = new mongoose.Schema({}, { strict: false, collection: "ledgerentries" });
const OrderSchema = new mongoose.Schema({}, { strict: false, collection: "orders" });

const User = mongoose.model("User", UserSchema);
const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);
const LedgerEntry = mongoose.model("LedgerEntry", LedgerEntrySchema);
const Order = mongoose.model("Order", OrderSchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    // Find any ledger account where availableBalance is non-zero, or entries match 1010, 5000, 6010, or 980
    const accounts = await LedgerAccount.find().lean();
    console.log(`Checking ${accounts.length} total ledger accounts...`);

    for (const acc of accounts) {
      const user = await User.findById(acc.userId).lean();
      const entries = await LedgerEntry.find({ accountId: acc._id }).sort({ createdAt: -1 }).lean();

      // Check if this is the test account the user is referring to
      const hasKeyAmount = entries.some(e => [1010, 6010, 5000, 980].includes(e.amount));
      if (hasKeyAmount || (user && user.name.toLowerCase().includes("test"))) {
        console.log(`\n========================================`);
        console.log(`User: ${user?.name} | Email: ${user?.email} | Phone: ${user?.phone} | Role: ${acc.type}`);
        console.log(`Account ID: ${acc._id} | User ID: ${acc.userId}`);
        console.log(`Available Balance: ${acc.availableBalance} | Pending: ${acc.pendingBalance} | Hold: ${acc.holdBalance}`);
        
        console.log(`Recent 15 entries:`);
        for (const entry of entries.slice(0, 15)) {
          console.log(`  - Entry ID: ${entry._id} | Amount: ${entry.amount} | Type: ${entry.entryType} | Reason: ${entry.reason} | Date: ${entry.createdAt} | Balance After: ${entry.balanceAfter}`);
        }
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
