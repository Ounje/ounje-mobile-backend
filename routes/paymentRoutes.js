const express = require("express");
const axios = require("axios"); 


const router = express.Router();
const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, // secret key from Paystack dashboard
    "Content-Type": "application/json"
  }
});


router.post("/initiate", async (req, res) =>{
    const { amount, email } = req.body;
    if (!amount || !email) return res.status(400).json({ error: "Missing amount or email" });

    try {
        const response = await paystack.post( 
        "transaction/initialize",
        {
            email,
            amount,
            callback_url: "http://localhost:5500/payment/callback",
        },
        {
            headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
            },
        }
        );
        // const payment = new Payment({ user, order, amount, reference: response.data.data.reference, status: "pending" });
        // await payment.save();
        res.json(response.data); // return authorization_url to frontend
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: "Payment initialization failed" });
    }
})

// routes/paymentRoutes.js
router.get("/verify/:reference", async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await paystack.get(
      `transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = response.data;
    if (data.status && data.data.status === "success") {
      const payment = new Payment({
        reference: data.data.reference,
        amount: data.data.amount / 100, // convert back to Naira
        email: data.data.customer.email,
        status: data.data.status,
        paidAt: data.data.paid_at,
      });
      await payment.save();
      // Credit seller, mark order as paid
      return res.json({ success: true, data: data.data });
    }

    res.status(400).json({ success: false, message: "Payment not successful" });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

module.exports = router;