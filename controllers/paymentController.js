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
    const customer = await Customer.findById(customerId);
    const email = customer.email;

    try {
        const response = await paystack.post( 
        "transaction/initialize",
        {
            email,
            amount,
            callback_url: "http://localhost:5000/api/payment/verify",
        }, 
        {
            headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}`,
            "Content-Type": "application/json",
            },
        }
        );
        const payment = new Payment({ customer: customerId, orderId, amount, reference: response.data.data.reference, status: "pending" });
        await payment.save();
        res.json(response.data); 
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: "Payment initialization failed" });
    }
}

const verifyPayment = async (req, res) => {
  const reference = req.query.reference;

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
    console.log(data);
    if (data.status && data.data.status === "success") {
        payment.amount= data.data.amount / 100, // convert back to Naira
        payment.status= data.data.status,
        payment.paidAt= data.data.paid_at
      await payment.save();
      // Credit seller, mark order as paid
      return res.json({ success: true, data: data.data });
    }

    res.status(400).json({ success: false, message: "Payment not successful" });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Payment verification failed" });
  }
}

const webhookHandler = async (req, res) => {
  const secret = process.env.PAYSTACK_TEST_SECRET_KEY;
  const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
    if (hash == req.headers['x-paystack-signature']) {
      // Retrieve the request's body
      const event = req.body;
      console.log("Webhook event received:", event);
      // Do something with event  
     }
  res.send(200);
  res.status(200).send("Webhook received");
}


module.exports = {
    initialisePayment,
    verifyPayment,
    webhookHandler,
}