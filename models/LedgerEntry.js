const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const ledgerEntrySchema = new Schema({
    accountId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount', required: true, index: true },
    contraAccountId: { type: Schema.Types.ObjectId, ref: 'LedgerAccount' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    amount: { type: Number, required: true }, // positive numbers only; type will indicate DEBIT/CREDIT meaning
    entryType: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
    reason: { type: String, enum: ['ORDER_EARNING', 'COMMISSION', 'PAYOUT', 'PAYOUT_PENDING', 'ADJUSTMENT', 'REFUND', 'REVERSAL'], required: true },
    meta: { type: Schema.Types.Mixed },
    balanceAfter: { type: Number }, // fill for convenience (cached snapshot after applying this entry within txn)
}, { timestamps: true });


const LedgerEntry = model('LedgerEntry', ledgerEntrySchema);
module.exports = LedgerEntry;