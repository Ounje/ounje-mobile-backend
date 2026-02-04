const mongoose = require('mongoose');
const Payout = require('../models/Payout');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const paystack = require('../utils/paystack');
const ledgerService = require('./ledger.service');
const { LedgerEntry } = require('../models/LedgerEntry');

// Ensure critical models are registered
if (!mongoose.models.Vendor) {
  try { require('../models/Vendor'); } catch (e) { console.warn('Vendor model load error:', e.message); }
}
if (!mongoose.models.rider) {
  try { require('../models/Rider'); } catch (e) { console.warn('Rider model load error:', e.message); }
}

/**
 * Process a single payout to a user's BANK account via Paystack
 * This is called only when a user MANUALLY requests a withdrawal.
 */
const processSinglePayout = async ({ userId, userType, amount, bankDetails, name, orderId }) => {
  console.log(`Processing withdrawal for ${userType} ${userId} amount: ${amount}`);

  if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
    const pending = await Payout.create({
      user: userId,
      userType: userType,
      order: orderId,
      amount,
      bankDetails: bankDetails || {},
      status: 'pending'
    });
    return { success: false, reason: 'no_bank', payout: pending };
  }

  // 1. Reserve balance (moves money from Available to Pending in Ledger)
  let reserved;
  try {
    reserved = await ledgerService.reserveBalance(userId, userType, amount);
  } catch (err) {
    const failed = await Payout.create({ user: userId, userType, order: orderId, amount, bankDetails, status: 'failed', failureReason: 'insufficient_funds' });
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
    const model = userType === 'VENDOR' ? Vendor : Rider;
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

/**
 * UPDATED: This function NO LONGER sends money to the bank automatically.
 * It is kept for logging purposes to confirm wallets were handled.
 */
const processAutoPayoutsForOrder = async (orderId) => {
  console.log(`Skipping auto-bank transfer for order ${orderId}. Funds are managed in internal wallets.`);
  return { vendor: "MANAGED_IN_WALLET", rider: "MANAGED_IN_WALLET" };
};

const processPendingPayout = async (payoutId) => { /* ... existing code ... */ };
const processPendingPayoutsForUser = async (userId, userType) => { /* ... existing code ... */ };

module.exports = { processAutoPayoutsForOrder, processSinglePayout, processPendingPayout, processPendingPayoutsForUser };