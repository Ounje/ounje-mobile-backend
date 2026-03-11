const { LedgerAccount, LedgerEntry } = require("../models");
const { paginate } = require("../utils/paginate");
const mongoose = require("mongoose");
/**
 * Move funds from pending -> available when order completes
 */
async function settleOrderEarnings(accountId, amount, orderId) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const account = await LedgerAccount.findById(accountId).session(session);
      if (!account) throw new Error("Account not found");
      if (account.pendingBalance < amount)
        throw new Error("Insufficient pending balance");

      // debit pending (DEBIT pendingBalance)
      const debitEntry = await LedgerEntry.create(
        [
          {
            accountId,
            amount,
            entryType: "DEBIT",
            reason: "ORDER_EARNING",
            meta: { action: "pending_to_available", orderId },
            balanceAfter: account.availableBalance, // will be updated after credits
          },
        ],
        { session },
      ).then((r) => r[0]);

      account.pendingBalance -= amount;
      account.availableBalance += amount;
      await account.save({ session });

      // create credit entry for available
      const creditEntry = await LedgerEntry.create(
        [
          {
            accountId,
            amount,
            entryType: "CREDIT",
            reason: "ORDER_EARNING",
            meta: { action: "pending_to_available", orderId },
            balanceAfter: account.availableBalance,
          },
        ],
        { session },
      ).then((r) => r[0]);

      result = { debitEntry, creditEntry };
    });
    return result;
  } finally {
    session.endSession();
  }
}

const getAccountHistory = async (req, res) => {
  try {
    const { accountId } = req.params;
    const result = await paginate(LedgerEntry, { ...req.query, accountId });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  settleOrderEarnings,
  getAccountHistory,
};
