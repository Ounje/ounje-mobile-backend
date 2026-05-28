const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

const LedgerAccountSchema = new mongoose.Schema({
  availableBalance: { type: Number, default: 0 },
}, { strict: false, collection: "ledgeraccounts" });
const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    let acc = await LedgerAccount.findById("69ebe217af62f56bd93b5377");
    console.log(`1. Balance before edit: ${acc.availableBalance}`);

    acc.availableBalance = 130;
    const saved = await acc.save();
    console.log(`2. Balance after save() call: ${saved.availableBalance}`);

    // Fetch again from DB immediately
    let acc2 = await LedgerAccount.findById("69ebe217af62f56bd93b5377");
    console.log(`3. Balance fetched immediately after save: ${acc2.availableBalance}`);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
