const express = require("express");
const crypto = require("crypto");

const router = express.Router();

router.post("/paystack", express.json({ type: "*/*" }), (req, res) => {
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash === req.headers["x-paystack-signature"]) {
    const event = req.body;
    
    if (event.event === "charge.success") {
      // ✅ Payment confirmed
      // Update order/payment in DB
    }
  }

  res.sendStatus(200);
});

module.exports = router;
