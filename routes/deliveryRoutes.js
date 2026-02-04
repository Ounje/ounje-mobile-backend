const express = require('express');
const router = express.Router();
// Import the logic from your utils folder
const { calculateOunjeFee } = require('../utils/delivery');

// Define the route using router.get instead of app.get
/**
 * @swagger
 * tags:
 *   name: Delivery
 *   description: Delivery Fee Calculation
 */

/**
 * @swagger
 * /api/delivery/quote:
 *   get:
 *     summary: Get delivery quote
 *     tags: [Delivery]
 *     parameters:
 *       - in: query
 *         name: vendor
 *         required: true
 *         schema:
 *           type: string
 *           description: Vendor address
 *       - in: query
 *         name: customer
 *         required: true
 *         schema:
 *           type: string
 *           description: Customer address
 *     responses:
 *       200:
 *         description: Delivery quote
 */
router.get('/quote', async (req, res) => {
    try {
        const { vendor, customer } = req.query;

        if (!vendor || !customer) {
            return res.status(400).json({
                success: false,
                message: "Vendor and Customer addresses are required"
            });
        }

        const fee = await calculateOunjeFee(vendor, customer);

        if (fee === null) {
            return res.status(500).json({
                success: false,
                message: "Error calculating delivery fee"
            });
        }

        res.status(200).json({
            success: true,
            data: {
                vendorAddress: vendor,
                customerAddress: customer,
                deliveryFee: fee,
                currency: "NGN"
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;