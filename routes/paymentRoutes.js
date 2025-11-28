const express = require("express");
const { initialisePayment, verifyPayment, webhookHandler } = require("../controllers/paymentController");
const { authMiddleware, roleGuard, ipWhitelist } = require("../middleware/auth");
const router = express.Router();



router.post("/initiate", authMiddleware, roleGuard(["customer"]), initialisePayment)

router.get("/verify", verifyPayment); 

router.post("/webhook", ipWhitelist(["52.31.139.75", "52.49.173.169", "52.214.14.220"]), webhookHandler); 

module.exports = router;