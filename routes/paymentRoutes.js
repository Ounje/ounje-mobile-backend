const express = require("express");
const { initialisePayment, verifyPayment, webhookHandler } = require("../controllers/paymentController");
const { authMiddleware, roleGuard, ipWhitelist } = require("../middleware/auth");
const router = express.Router();



router.post("/initiate", authMiddleware, roleGuard(["customer"]), initialisePayment)

router.get("/verify", verifyPayment); 

router.post("/webhook", webhookHandler); 

module.exports = router;