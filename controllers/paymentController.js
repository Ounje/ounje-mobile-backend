const axios = require("axios"); 
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const Order = require("../models/Order");
const crypto = require('crypto');
const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}`,
    "Content-Type": "application/json"
  }
});


const initialisePayment = async (req, res) =>{
    const { orderId } = req.body;
    const customerId = req.user.id;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const amount = order.totalPrice * 100; 
    const existing = await Payment.findOne({ orderId: order._id, status: 'pending' });
    if (existing) {
      return res.json({
        message: 'Existing pending payment found',
        authorization_url: existing.authorizationUrl,
        reference: existing.reference,
      });
    }
    const customer = await Customer.findById(customerId);
    const email = customer.email;

    try {
        const response = await paystack.post( 
        "transaction/initialize",
        {
            email,
            amount,
            callback_url: `${process.env.BASE_URL}/api/payments/verify`,
            metadata: { orderId: orderId, customerId: customerId },
        }, 
        {
            headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}`,
            "Content-Type": "application/json",
            },
        }
        );
        const payment = new Payment({ customer: customerId, orderId, amount, reference: response.data.data.reference,
          authorizationUrl: response.data.data.authorization_url, status: "pending" });
        await payment.save();
        res.json(response.data); 
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: "Payment initialization failed" });
    }
}

const verifyPayment = async (req, res) => {
  const reference = req.query.reference;
  if (!reference) return res.status(400).json({ error: "Missing reference" });

  try {
    const response = await paystack.get(
      `transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}`,
        },
      }
    );

    const data = response.data;
    const payment = await Payment.findOne({ reference });
    if (!payment) {
      return res.status(404).json({ error: "Payment record not found" });
    }
    if (payment.status === "success") {
      return res.json({ success: true, message: "Already verified" });
    }
    console.log(data);
    if (data.status && data.data.status === "success") {
        payment.amount= data.data.amount / 100, // convert back to Naira
        payment.status= data.data.status,
        payment.paidAt= data.data.paid_at
      await payment.save();
      await Order.findByIdAndUpdate(payment.orderId, { paymentStatus: "paid" })
      // Credit seller, mark order as paid
      return res.json({ success: true, data: data.data });
    }
    payment.status = data.data.status;
    await payment.save();
    res.status(400).json({ success: false, message: "Payment not successful", data: data.data });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Payment verification failed" });
  }
}

const webhookHandler = async (req, res) => {
  console.log("Received webhook");
  console.log(req.ip);
  const secret = process.env.PAYSTACK_TEST_SECRET_KEY;
  const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
  if (hash != req.headers['x-paystack-signature']) {
    console.error("Invalid signature");
    return res.status(400).send("Invalid signature");
  }
  try {
    const event = req.body;


    if (event.event !== "charge.success") {
      return res.status(200).send("Event ignored");
    }

    const { reference, amount, paid_at, metadata } = event.data;
    const orderId = metadata.orderId;

    const payment = await Payment.findOne({ reference });
    const order = await Order.findById(orderId);

    if (!payment) {
      console.log("Payment missing, creating…");
      await Payment.create({
        reference,
        orderId,
        amount: amount / 100,
        status: "success",
        paidAt: paid_at,
      });
    }
    if (payment.status === "success") {
      return res.status(200).send("Already processed");
    }

    payment.status = "success";
    payment.amount = amount / 100;
    payment.paidAt = paid_at;
    await payment.save();
    

    if (order) {
      order.paymentStatus = "paid";
      await order.save();
    }

    const vendorCommissionRate = 0.10;
    const vendorGross = order.foodTotal;
    const vendorCommission = vendorGross * vendorCommissionRate;

    // Vendor receives:
    const vendorNet = vendorGross - vendorCommission;

    return res.status(200).send("Webhook processed");
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).send("Server error");
  }
}


module.exports = {
    initialisePayment,
    verifyPayment,
    webhookHandler,
}