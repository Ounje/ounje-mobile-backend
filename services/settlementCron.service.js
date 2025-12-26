// Settlement cron removed — auto payouts and ledger handle payouts now.
// If you need a periodic reconcile job in future, implement a cron that queries Payout records
// and reconciles transfer statuses with the external provider via stored idempotency/reference.

exports.processSettlements = async () => {
  console.warn('settlementCron.service is deprecated. Auto payouts and ledger service should be used.');
};
