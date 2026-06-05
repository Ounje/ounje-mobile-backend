const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const UserSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const CustomerSchema = new mongoose.Schema({}, { strict: false, collection: "customers" });
const LedgerAccountSchema = new mongoose.Schema({}, { strict: false, collection: "ledgeraccounts" });
const LedgerEntrySchema = new mongoose.Schema({}, { strict: false, collection: "ledgerentries" });

const User = mongoose.model("User", UserSchema);
const Customer = mongoose.model("Customer", CustomerSchema);
const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);
const LedgerEntry = mongoose.model("LedgerEntry", LedgerEntrySchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    // Find User Dandy or phone containing 9063951220
    const user = await User.findOne({ 
      $or: [
        { name: /Dandy/i },
        { phone: /9063951220/ }
      ]
    }).lean();

    if (!user) {
      console.log("User Dandy not found in User model.");
      return;
    }

    console.log("Found User:", user);

    const customer = await Customer.findOne({ user: user._id }).lean();
    console.log("Found Customer:", customer);

    const ledgerAcc = await LedgerAccount.findOne({ userId: user._id }).lean();
    console.log("Found Ledger Account:", ledgerAcc);

    if (ledgerAcc) {
      const entries = await LedgerEntry.find({ accountId: ledgerAcc._id }).sort({ createdAt: 1 }).lean();
      console.log(`Found ${entries.length} entries:`);
      for (const e of entries) {
        console.log(`- ID: ${e._id} | Amount: ${e.amount} | Type: ${e.entryType} | Reason: ${e.reason} | Date: ${e.createdAt} | BalanceAfter: ${e.balanceAfter}`);
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
