const paystack = require("../utils/paystack");
const VendorSettlement = require("../models/VendorSettlement");
const RiderEarnings = require("../models/RiderEarnings");
const Vendor = require("../models/Vendor");

exports.processSettlements = async () => {
  const pendingVendors = await VendorSettlement.find({ status: "pending" });

  for (const settlement of pendingVendors) {
    const vendor = await Vendor.findById(settlement.vendor);

    try {
      await paystack.transfer.initiate({
        amount: settlement.netPayable * 100,
        recipient: vendor.paystackRecipientCode,
        reason: `Payout for order ${settlement.order}`
      });

      settlement.status = "paid";
      settlement.paidAt = new Date();
      await settlement.save();

    } catch (err) {
      console.error("Vendor payout failed:", err.message);
    }
  }


  
const pendingRiders = await RiderEarnings.find({ status: "pending" });

  for (const earning of pendingRiders) {
    const rider = await Rider.findById(earning.rider);

    try {
      await paystack.transfer.initiate({
        amount: earning.amount * 100,
        recipient: rider.paystackRecipientCode,
        reason: `Delivery earnings for order ${earning.order}`
      });

      earning.status = "paid";
      earning.paidAt = new Date();
      await earning.save();

    } catch (err) {
      console.error("Rider payout failed:", err.message);
    }
  }
};
