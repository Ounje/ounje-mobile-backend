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
    
    // 1. Fetch current ledger account
    const acc = await LedgerAccount.findById(accountId);
    if (!acc) {
      console.error("Ledger account not found!");
      return;
    }
    
    console.log(`Original balance: ${acc.availableBalance}`);
    
    const duplicateAmount = 5880;
    const newBalance = acc.availableBalance - duplicateAmount; // 6010 - 5880 = 130
    
    console.log(`Adjusting balance to: ${newBalance}`);
    
    // 2. Update LedgerAccount balance
    acc.availableBalance = newBalance;
    await acc.save();
    console.log("Ledger account balance updated successfully.");

    // 3. Create ADJUSTMENT entry
    const entry = new LedgerEntry({
      accountId: accountId,
      amount: duplicateAmount,
      entryType: "DEBIT",
      reason: "ADJUSTMENT",
      meta: { description: "Reverting duplicate refunds from declined orders" },
      balanceAfter: newBalance,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await entry.save();
    console.log("Created ADJUSTMENT ledger entry:", entry._id);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
