const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

if (!mongoUri) {
  console.error("MONGO_URI or MONGO_DB_URI not found in env");
  process.exit(1);
}

// Inline schemas/models since we just need to query
const UserSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const CustomerSchema = new mongoose.Schema({}, { strict: false, collection: "customers" });
const OrderSchema = new mongoose.Schema({}, { strict: false, collection: "orders" });
const LedgerAccountSchema = new mongoose.Schema({}, { strict: false, collection: "ledgeraccounts" });
const LedgerEntrySchema = new mongoose.Schema({}, { strict: false, collection: "ledgerentries" });

const User = mongoose.model("User", UserSchema);
const Customer = mongoose.model("Customer", CustomerSchema);
const Order = mongoose.model("Order", OrderSchema);
const LedgerAccount = mongoose.model("LedgerAccount", LedgerAccountSchema);
const LedgerEntry = mongoose.model("LedgerEntry", LedgerEntrySchema);

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected successfully!");

    // 1. Find recent customers
    const customers = await Customer.find().lean();
    console.log(`Found ${customers.length} customers.`);

    const users = await User.find({ role: "customer" }).lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    console.log("\n--- CUSTOMER LIST ---");
    for (const c of customers) {
      const user = userMap.get(c.user?.toString());
      console.log(`Customer ID: ${c._id}`);
      console.log(`User Name: ${user?.name || "N/A"} | Email: ${user?.email || "N/A"} | Phone: ${user?.phone || c.phone || "N/A"}`);
      console.log(`Paystack Code: ${c.paystackCustomerCode}`);
      console.log(`Titan DVA Account: ${JSON.stringify(c.titanAccount)}`);
      
      // Look up Ledger Account
      const ledgerAcc = await LedgerAccount.findOne({ customer: c._id }).lean();
      console.log(`Ledger Account Balance: ${ledgerAcc?.balance} | Pending: ${ledgerAcc?.pendingBalance}`);
      console.log("------------------------");
    }

    // 2. Find recent orders
    const orders = await Order.find().sort({ createdAt: -1 }).limit(10).lean();
    console.log("\n--- RECENT 10 ORDERS ---");
    for (const o of orders) {
      console.log(`Order ID: ${o._id} | Number: ${o.orderNumber} | Total: ${o.totalPrice} | Status: ${o.status} | Payment: ${o.paymentStatus}`);
    }

    // 3. Find ledger entries for the active/test customers
    console.log("\n--- RECENT LEDGER ENTRIES ---");
    const entries = await LedgerEntry.find().sort({ createdAt: -1 }).limit(20).lean();
    for (const e of entries) {
      console.log(`Entry ID: ${e._id} | Account: ${e.ledgerAccount} | Amount: ${e.amount} | Type: ${e.type} | Reason: ${e.reason} | Date: ${e.createdAt}`);
    }

  } catch (err) {
    console.error("Error running script:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

run();
