const mongoose = require('mongoose');
const { Order, Promotion, FoodItem, Combo, VendorProfile, RiderProfile, User, Counter } = require('./models');
const orderService = require('./services/order.service');
const authController = require('./controllers/authController');
require('dotenv').config();

async function runVerification() {
    try {
        console.log('--- STARTING VERIFICATION ---');

        // 1. Verify Sequential IDs
        console.log('\n[SCENARIO 1] Sequential ID Generation');
        const mockRes = { status: () => ({ json: (d) => d }) };
        
        // Mock registration data
        const vendorData = { name: 'Test Vendor', phone: '08000000001', role: 'vendor', password: 'password' };
        // Since we can't easily call register in a script without full req/res, 
        // we test the idGenerator and Counter logic directly.
        const idGenerator = require('./utils/idGenerator');
        const vId1 = await idGenerator.generateId('vendor_id', 'VND');
        const vId2 = await idGenerator.generateId('vendor_id', 'VND');
        console.log(`Generated IDs: ${vId1}, ${vId2}`);
        if (vId1.startsWith('VND-') && vId2.startsWith('VND-')) {
            console.log('✅ ID Format matches VND-XXXX');
        }

        // 2. Verify Pricing (Change 1 & 2)
        console.log('\n[SCENARIO 2] Pricing Markup (Change 1)');
        // Mock items
        const items = [
            {
                itemId: new mongoose.Types.ObjectId(), // Simulated
                itemType: 'FoodItem',
                quantity: 1,
                price: 2200,      // Customer see & pay
                originalPrice: 2000,
                category: 'Main'
            }
        ];

        const { serviceFee, vendorEarning, platformMarkupRevenue, comboMarkupRevenue } = 
            require('./services/order.service')._calculateFees(items);

        console.log(`Input Price: 2200, Original Price: 2000`);
        console.log(`Calculated: Vendor Earning=${vendorEarning}, Platform Markup=${platformMarkupRevenue}, serviceFee (stored)=${serviceFee}`);
        
        if (vendorEarning === 2000 && platformMarkupRevenue === 200) {
            console.log('✅ Change 1 logic matches Documentation');
        }

        console.log('\n[SCENARIO 3] Combo Markup & Promo Reversal (Change 2)');
        const comboItems = [
            {
                itemId: new mongoose.Types.ObjectId(),
                itemType: 'Combo',
                quantity: 1,
                price: 2640,
                originalPrice: 2000,
                category: 'Combo'
            }
        ];

        const noPromo = require('./services/order.service')._calculateFees(comboItems, false);
        const withPromo = require('./services/order.service')._calculateFees(comboItems, true);

        console.log(`Combo No Promo: Vendor=${noPromo.vendorEarning}, Platform Markup=${noPromo.platformMarkupRevenue}, Combo Markup=${noPromo.comboMarkupRevenue}`);
        console.log(`Combo With Promo: Vendor=${withPromo.vendorEarning}, Platform Markup=${withPromo.platformMarkupRevenue}, Combo Markup=${withPromo.comboMarkupRevenue}`);

        if (noPromo.platformMarkupRevenue === 200 && noPromo.comboMarkupRevenue === 440) {
            console.log('✅ Combo No-Promo math matches (200 + 440 = 640 platform take)');
        }
        if (withPromo.platformMarkupRevenue === 200 && withPromo.comboMarkupRevenue === 0) {
            console.log('✅ Combo With-Promo math matches (Platform keeps only standard 200)');
        }

        console.log('\n--- VERIFICATION COMPLETE ---');
    } catch (err) {
        console.error('❌ Verification failed:', err.message);
    }
}

runVerification();
