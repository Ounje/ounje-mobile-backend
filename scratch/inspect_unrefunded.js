const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("../models");

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    const orderIds = ["6a171db93d0a28415842825e", "69f45b4fff2c24cf6f951363"];
    
    for (const orderId of orderIds) {
      console.log(`\n================= INSPECTING ORDER: ${orderId} =================`);
      const Order = mongoose.model("Order");
      const LedgerEntry = mongoose.model("LedgerEntry");
      const LedgerAccount = mongoose.model("LedgerAccount");
      const Payment = mongoose.model("Payment");
      
      const order = await Order.findById(orderId).lean();
      if (!order) {
        console.log("Order not found!");
        continue;
      }
      console.log("Order Details:");
      console.log(`- Order Number: ${order.orderNumber}`);
      console.log(`- Status: ${order.status}`);
      console.log(`- Sub-Status: ${order.subStatus}`);
      console.log(`- Total Price: ₦${order.totalPrice}`);
      console.log(`- Payment Status: ${order.paymentStatus}`);
      console.log(`- Payment Method: ${order.paymentMethod}`);
      console.log(`- Customer ID: ${order.customer}`);
      console.log(`- Vendor ID: ${order.vendor}`);
      console.log(`- Created At: ${order.createdAt}`);
      console.log(`- Cancelled At: ${order.cancelledAt}`);
      console.log(`- Declined At: ${order.declinedAt}`);
      
      const payment = await Payment.findOne({ orderId: order._id }).lean();
      console.log("Payment Record:");
      if (payment) {
        console.log(`- ID: ${payment._id}`);
        console.log(`- Status: ${payment.status}`);
        console.log(`- Reference: ${payment.reference}`);
        console.log(`- Amount: ₦${payment.amount}`);
      } else {
        console.log("- None");
      }

      console.log("Ledger Entries for this Order:");
      const entries = await LedgerEntry.find({ orderId: order._id }).lean();
      if (entries.length > 0) {
        for (const e of entries) {
          const acc = await LedgerAccount.findById(e.accountId).lean();
          console.log(`- Entry ID: ${e._id} | Account: ${acc?.type} (${acc?.userId}) | Amount: ₦${e.amount} | Type: ${e.entryType} | Reason: ${e.reason} | Meta: ${JSON.stringify(e.meta)}`);
        }
      } else {
        console.log("- None");
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected.");
  }
}

run();
