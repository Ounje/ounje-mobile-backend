const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const UserSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const CustomerSchema = new mongoose.Schema({}, { strict: false, collection: "customers" });
const LedgerAccountSchema = new mongoose.Schema({}, { strict: false, collection: "ledgeraccounts" });
const LedgerEntrySchema = new mongoose.Schema({}, { strict: false, collection: "ledgerentries" });
const OrderSchema = new mongoose.Schema({}, { strict: false, collection: "orders" });

const User = mongoose.model("User", UserSchema);
const Customer = mongoose.model("Customer", CustomerSchema);
const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);
const LedgerEntry = mongoose.model("LedgerEntry", LedgerEntrySchema);
const Order = mongoose.model("Order", OrderSchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    // Find LedgerAccounts that are CUSTOMER and have non-zero balance, or look for topups of 1010
    const accounts = await LedgerAccount.find({ type: "CUSTOMER" }).lean();
    console.log(`Found ${accounts.length} CUSTOMER ledger accounts.`);

    for (const acc of accounts) {
      // Find User for this account
      const user = await User.findById(acc.userId).lean();
      
      // Find topup entries for this account
      const entries = await LedgerEntry.find({ accountId: acc._id }).lean();
      const hasTopup1010 = entries.some(e => e.amount === 1010 || e.amount === 6010 || e.amount === 5000);

      if (acc.availableBalance > 0 || hasTopup1010 || (user && user.name.toLowerCase().includes("test"))) {
        console.log(`\n========================================`);
        console.log(`Account ID: ${acc._id}`);
        console.log(`User ID: ${acc.userId} | Name: ${user?.name} | Email: ${user?.email} | Phone: ${user?.phone}`);
        console.log(`Balances - Available: ${acc.availableBalance} | Pending: ${acc.pendingBalance} | Hold: ${acc.holdBalance}`);
        
        console.log("Entries:");
        for (const entry of entries) {
          console.log(`  - Entry ID: ${entry._id} | Amount: ${entry.amount} | Type: ${entry.entryType} | Reason: ${entry.reason} | Date: ${entry.createdAt}`);
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
