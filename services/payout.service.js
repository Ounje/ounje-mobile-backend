const mongoose = require('mongoose');
const Payout = require('../models/Payout');
const User = require('../models/User');
const VendorProfile = require('../models/VendorProfile');
const RiderProfile = require('../models/RiderProfile');
const Order = require('../models/Order');
const paystack = require('../utils/paystack');
const ledgerService = require('./ledger.service');
const { LedgerEntry } = require('../models/LedgerEntry');

// Ensure critical models are registered
if (!mongoose.models.VendorProfile) {
  try { require('../models/VendorProfile'); } catch (e) { console.warn('VendorProfile model load error:', e.message); }
}
if (!mongoose.models.RiderProfile) {
  try { require('../models/RiderProfile'); } catch (e) { console.warn('RiderProfile model load error:', e.message); }
}

/**
 * HELPER: Calculates total deductions (Paystack Fee + 2026 Stamp Duty)
 * Based on Paystack Nigeria Transfer Rates and 2026 Tax Laws.
 */
const calculateTotalFees = (amount) => {
  let paystackFee = 0;
  let stampDuty = 0;

  // 1. Paystack Transfer Fee Bands
  if (amount <= 5000) {
    paystackFee = 10;
  } else if (amount <= 50000) {
    paystackFee = 25;
  } else {
    paystackFee = 50;
  }

  // 2. 2026 Electronic Money Transfer Levy (Stamp Duty)
  // Re-introduced Jan 1, 2026: SENDER pays N50 on transfers of N10,000+
  if (amount >= 10000) {
    stampDuty = 50;
  }

  return {
    paystackFee,
    stampDuty,
    total: paystackFee + stampDuty
  };
};

/**
 * Process a single payout to a user's BANK account via Paystack
 */
const processSinglePayout = async ({ userId, userType, amount, bankDetails, name, orderId }) => {
  console.log(`Processing withdrawal for ${userType} ${userId} amount: ${amount}`);

  // Calculate deductions first
  const fees = calculateTotalFees(amount);
  const netAmount = amount - fees.total;

  if (netAmount <= 0) {
    return { success: false, reason: 'amount_too_low', detail: `Amount NGN ${amount} cannot cover fees of NGN ${fees.total}` };
  }

  if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
    const pending = await Payout.create({
      user: userId,
      userType: userType,
      order: orderId,
      amount,
      feeDeducted: fees.total,
      netAmount: netAmount,
      bankDetails: bankDetails || {},
      status: 'pending'
    });
    return { success: false, reason: 'no_bank', payout: pending };
  }

  // 1. Reserve balance (moves money from Available to Pending in Ledger)
  let reserved;
  try {
    // We reserve the FULL amount the user requested from their ledger
    reserved = await ledgerService.reserveBalance(userId, userType, amount);
  } catch (err) {
    const failed = await Payout.create({ 
      user: userId, 
      userType, 
      order: orderId, 
      amount, 
      bankDetails, 
      status: 'failed', 
      failureReason: 'insufficient_funds' 
    });
    return { success: false, reason: 'insufficient_funds', payout: failed };
  }

  let payout = await Payout.create({
    user: userId,
    userType,
    order: orderId,
    amount,
    bankDetails,
    status: 'processing',
    ledgerEntry: reserved.entry._id,
    idempotencyKey: `payout_${new Date().getTime()}_${userId}`
  });

  try {
    // 2. Resolve Paystack Recipient
    let recipientCode;
    const model = userType === 'VENDOR' ? VendorProfile : RiderProfile;
    const user = await model.findById(userId);

    if (user.paystackRecipientCode) {
      recipientCode = user.paystackRecipientCode;
    } else {
      const recipient = await paystack.recipients.create({
        name: name || user.name || 'Recipient',
        account_number: bankDetails.accountNumber,
        bank_code: bankDetails.bankCode
      });
      recipientCode = recipient?.data?.recipient_code;
      if (!recipientCode) throw new Error('Failed to get recipient code');
      user.paystackRecipientCode = recipientCode;
      await user.save();
    }

    // 3. Trigger Transfer
    const transfer = await paystack.transfer.initiate({
      amount: Math.round(amount * 100),
      recipient: recipientCode,
      reason: `Wallet Withdrawal`,
      idempotencyKey: payout.idempotencyKey
    });

    const transferCode = transfer?.data?.transfer_code;

    // 4. Complete Payout in Ledger
    await ledgerService.completePayout(userId, userType, amount);

    payout.status = 'completed';
    payout.transactionRef = transferCode;
    payout.processedAt = new Date();
    await payout.save();

    return { success: true, payout };
  } catch (err) {
    console.error('Transfer failed:', err.message);
    await ledgerService.reverseReserve(userId, userType, amount, `Withdrawal failed: ${err.message}`);
    payout.status = 'failed';
    payout.failureReason = err.message;
    await payout.save();
    return { success: false, reason: 'transfer_failed', error: err.message, payout };
  }
};

const processAutoPayoutsForOrder = async (orderId) => {
  console.log(`Skipping auto-bank transfer for order ${orderId}. Funds are managed in internal wallets.`);
  return { vendor: "MANAGED_IN_WALLET", rider: "MANAGED_IN_WALLET" };
};

const processPendingPayout = async (payoutId) => { /* ... existing logic ... */ };
const processPendingPayoutsForUser = async (userId, userType) => { /* ... existing logic ... */ };

module.exports = { processAutoPayoutsForOrder, processSinglePayout, processPendingPayout, processPendingPayoutsForUser };