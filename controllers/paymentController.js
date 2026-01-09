const axios = require("axios");
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const Order = require("../models/Order");
const crypto = require("crypto");
const ledgerService = require("../services/ledger.service");
const payoutService = require("../services/payout.service");
const Vendor = require("../models/Vendor");

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

const initialisePayment = async (req, res) => {
  // ... (Your initialization logic is fine, just ensure customer.email is passed)
};

const verifyPayment = async (req, res) => {
  // ... (Your verification logic)
};

const webhookHandler = async (req, res) => {
  const secret = process.env.PAYSTACK_TEST_SECRET_KEY;
  const hash = crypto.createHmac("sha512", secret).update(JSON.stringify(req.body)).digest("hex");

  if (hash != req.headers["x-paystack-signature"]) {
    return res.status(400).send("Invalid signature");
  }

  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const { amount, metadata } = event.data;
      const order = await Order.findById(metadata.orderId).populate('items');

      if (!order) return res.status(404).send("Order not found");

      // 1. Mark Order as Paid
      order.paymentStatus = "paid";
      await order.save();

      // 2. Calculate the Distribution
      const totalPaid = amount / 100;
      const deliveryFee = order.deliveryFee || 0;
      const mealPrice = order.items.reduce((sum, item) => sum + item.price, 0);

      // 3. CHANNEL 1: Credit Vendor Wallet (Available Balance)
      await ledgerService.creditAccount(
        order.vendor,
        "VENDOR",
        mealPrice,
        "ORDER_EARNING",
        order._id,
        { type: "MEAL_PRICE" }
      );

      // 4. CHANNEL 2: Put Rider Fee on HOLD (Escrow)
      if (order.rider && deliveryFee > 0) {
        await ledgerService.holdRiderFee(order.rider, deliveryFee, order._id);
      }

      // CHANNEL 3: Service Fee 
      // This is implicit. Since you didn't credit it to a user, it stays in your Paystack balance.

      console.log(`✓ Webhook Success: Order ${order._id} distributed to wallets.`);
    }

    return res.status(200).send("Webhook processed");
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).send("Server error");
  }
};

module.exports = { initialisePayment, verifyPayment, webhookHandler };