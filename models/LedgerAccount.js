const { Schema, model } = require('mongoose');


const ledgerAccountSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, enum: ['VENDOR', 'RIDER', 'PLATFORM'], required: true },
    // cached snapshots for quick reads; the source of truth is ledger_entries aggregation
    availableBalance: { type: Number, default: 0 },
    pendingBalance: { type: Number, default: 0 },
    holdBalance: { type: Number, default: 0 },
}, { timestamps: true });


const LedgerAccount = model('LedgerAccount', ledgerAccountSchema);
module.exports = LedgerAccount;