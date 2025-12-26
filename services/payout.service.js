const Payout = require('../models/Payout');
const Vendor = require('../models/Vendor');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const paystack = require('../utilis/paystack');
const ledgerService = require('./ledger.service');

/**
 * Process a single payout to a user (vendor or rider)
 * - Reserve balance (pending)
 * - Create paystack recipient if missing
 * - Initiate transfer
 * - On success: complete payout (debit pending)
 * - On failure: reverse reserve
 */
const processSinglePayout = async ({ userId, userType, amount, bankDetails, name }) => {
  if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
    // Create a pending payout record to be processed by admin later
    const pending = await Payout.create({
      user: userId,
      userType: userType,
      amount,
      bankDetails: bankDetails || {},
      status: 'pending'
    });
    return { success: false, reason: 'no_bank', payout: pending };
  }

  // Reserve balance
  let reserved;
  try {
    reserved = await ledgerService.reserveBalance(userId, userType, amount);
  } catch (err) {
    console.error('Insufficient funds to reserve for payout:', err.message);
    const failed = await Payout.create({ user: userId, userType, amount, bankDetails, status: 'failed', failureReason: 'insufficient_funds' });
    return { success: false, reason: 'insufficient_funds', payout: failed };
  }

  // Create payout record in processing state (persist BEFORE transfer for idempotency)
  let payout = await Payout.create({ user: userId, userType, amount, bankDetails, status: 'processing', ledgerEntry: reserved.entry._id });

  // Set a stable idempotency key tied to payout._id (used as Idempotency-Key header)
  payout.idempotencyKey = `payout_${payout._id}`;
  await payout.save();

  try {
    // Ensure paystack recipient exists
    let recipientCode;
    const model = userType === 'VENDOR' ? Vendor : Rider;
    const user = await model.findById(userId);

    if (user.paystackRecipientCode) recipientCode = user.paystackRecipientCode;
    else {
      const recipient = await paystack.recipients.create({ name: name || user.name || user.accountName || 'Recipient', account_number: bankDetails.accountNumber, bank_code: bankDetails.bankCode });
      recipientCode = recipient?.data?.recipient_code || recipient?.data?.recipientCode || recipient?.data?.recipientId || recipient?.recipient_code;
      if (!recipientCode) throw new Error('Failed to get recipient code from Paystack');
      user.paystackRecipientCode = recipientCode;
      await user.save();
    }

    // If payout already completed earlier, return existing record
    if (payout.transactionRef && payout.status === 'completed') {
      return { success: true, payout };
    }

    // Initiate transfer (amount in kobo), passing Idempotency-Key header to avoid duplicate transfers
    const transfer = await paystack.transfer.initiate({ amount: Math.round(amount * 100), recipient: recipientCode, reason: `Order payout`, idempotencyKey: payout.idempotencyKey });

    const transferCode = transfer?.data?.transfer_code || transfer?.data?.transferCode || transfer?.transfer_code || transfer?.data?.reference;

    // Complete ledger payout (debit pending)
    await ledgerService.completePayout(userId, userType, amount);

    payout.status = 'completed';
    payout.transactionRef = transferCode;
    payout.processedAt = new Date();
    await payout.save();

    return { success: true, payout };
  } catch (err) {
    console.error('Payout processing failed:', err.message);
    // Reverse reserved funds
    try {
      await ledgerService.reverseReserve(userId, userType, amount, `Auto payout failed: ${err.message}`);
    } catch (rerr) {
      console.error('Failed to reverse reserve after payout failure:', rerr.message);
    }

    payout.status = 'failed';
    payout.failureReason = err.message;
    await payout.save();

    return { success: false, reason: 'transfer_failed', error: err.message, payout };
  }
};

/**
 * Process automatic payouts for an order: both vendor and rider (if applicable)
 */
const processAutoPayoutsForOrder = async (orderId) => {
  const order = await Order.findById(orderId).populate('vendor').populate('rider').populate('customer');
  if (!order) throw new Error('Order not found');

  const results = { vendor: null, rider: null };

  // Vendor payout (vendorNet after commission)
  const commission = 0.10;
  const vendorGross = order.totalPrice;
  const vendorNet = vendorGross - vendorGross * commission;

  if (order.vendor) {
    const vendor = await Vendor.findById(order.vendor);
    const bank = vendor?.bankDetails;
    results.vendor = await processSinglePayout({ userId: vendor._id, userType: 'VENDOR', amount: vendorNet, bankDetails: bank, name: vendor.name });
  }

  // Rider payout (delivery fee)
  const deliveryFee = order.deliveryFee || 0;
  if (order.rider && deliveryFee > 0) {
    const rider = await Rider.findById(order.rider);
    const bank = rider?.bankDetails;
    results.rider = await processSinglePayout({ userId: rider._id, userType: 'RIDER', amount: deliveryFee, bankDetails: bank, name: rider.name });
  }

  return results;
};

module.exports = { processAutoPayoutsForOrder, processSinglePayout };
