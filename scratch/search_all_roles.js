const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const UserSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const CustomerSchema = new mongoose.Schema({}, { strict: false, collection: "customers" });
const LedgerAccountSchema = new mongoose.Schema({}, { strict: false, collection: "ledgeraccounts" });

const User = mongoose.model("User", UserSchema);
const Customer = mongoose.model("Customer", CustomerSchema);
const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    // Search users by name "Dandy", "Salu", "Divine", "Amaks" or phone 9063951220
    const users = await User.find({
      $or: [
        { name: /Dandy/i },
        { name: /Salu/i },
        { name: /Divine/i },
        { name: /Amaks/i },
        { phone: /9063951220/ }
      ]
    }).lean();

    console.log(`Found ${users.length} matching users:`);
    for (const u of users) {
      console.log(`User ID: ${u._id} | Name: ${u.name} | Role: ${u.role} | Phone: ${u.phone} | Email: ${u.email}`);
      const customer = await Customer.findOne({ user: u._id }).lean();
      console.log(`  Customer: ${customer ? customer._id : "None"}`);
      const ledger = await LedgerAccount.findOne({ userId: u._id }).lean();
      console.log(`  Ledger Account: ${ledger ? ledger._id + " (balance: " + ledger.availableBalance + ")" : "None"}`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
