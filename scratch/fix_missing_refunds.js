const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("../models");
const ledgerService = require("../services/ledger.service");

const mongoUri = process.env.MONGO_DB_URI || process.env.MONGO_URI;

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    const Order = mongoose.model("Order");
    const orderIds = ["6a171db93d0a28415842825e", "69f45b4fff2c24cf6f951363"];

    for (const orderId of orderIds) {
      console.log(`\nRefunding Order: ${orderId}`);
      const order = await Order.findById(orderId);
      if (!order) {
        console.log("- Order not found!");
        continue;
      }
      if (order.paymentStatus !== "paid") {
        console.log(`- Skipping: paymentStatus is ${order.paymentStatus}`);
        continue;
      }

      order.paymentStatus = "refunded";
      await order.save();

      const originalPaymentMethod = order.paymentMethod || "paystack";
      const result = await ledgerService.creditAccount(
        order.customer,
        "CUSTOMER",
        order.totalPrice,
        "REFUND",
        order._id,
        { reason: "reconciliation_fix", originalPaymentMethod },
      );

      console.log(`- Refund processed successfully! New Balance: ₦${result.newBalance}`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected.");
  }
}

run();
