const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const LedgerAccountSchema = new mongoose.Schema({}, { strict: false, collection: "ledgeraccounts" });
const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    const acc = await LedgerAccount.findById("69ebe217af62f56bd93b5377").lean();
    console.log(`Current Dandy Ledger Account Balance in DB: ${acc?.availableBalance}`);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
