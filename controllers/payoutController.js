const ledgerService = require("../services/ledger.service");
const { Payout } = require("../models");
const payoutService = require("../services/payout.service");

/**
 * Get current balance for rider/vendor
 * GET /api/payouts/balance
 */
const getBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.role; // 'rider' or 'vendor' from middleware

    if (!["rider", "vendor"].includes(userType)) {
      return res.status(403).json({ error: "Only riders and vendors can view balances" });
    }

    const balance = await ledgerService.getAccountBalance(userId, userType.toUpperCase());
    res.json(balance);
  } catch (error) {
    console.error("Balance fetch error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get transaction history
 * GET /api/payouts/history?limit=20&skip=0
 */
const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.role;
    const { limit = 20, skip = 0 } = req.query;

    if (!["rider", "vendor"].includes(userType)) {
      return res.status(403).json({ error: "Only riders and vendors can view history" });
    }

    const history = await ledgerService.getTransactionHistory(
      userId,
      userType.toUpperCase(),
      parseInt(limit),
      parseInt(skip)
    );

    res.json(history);
  } catch (error) {
    console.error("History fetch error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Request a payout (reserve balance)
 * POST /api/payouts/request
 * Body: { amount, bankDetails: { accountNumber, bankCode, accountName } } 
 */
const requestPayout = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.role;
    const { amount, bankDetails } = req.body;

    if (!["rider", "vendor"].includes(userType)) {
      return res.status(403).json({ error: "Only riders and vendors can request payouts" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    if (!bankDetails || !bankDetails.accountNumber || !bankDetails.bankCode) {
      return res.status(400).json({ error: "Bank details required" });
    }

    // Check current balance
    const balance = await ledgerService.getAccountBalance(userId, userType.toUpperCase());
    if (balance.availableBalance < amount) {
      return res.status(400).json({
        error: `Insufficient balance. Available: ₦${balance.availableBalance}`,
        availableBalance: balance.availableBalance,
      });
    }

    // Reserve the balance (move from available to pending)
    const reserved = await ledgerService.reserveBalance(userId, userType.toUpperCase(), amount);

    // Create payout record
    const payout = await Payout.create({
      user: userId,
      userType: userType.toUpperCase(),
      amount,
      bankDetails,
      status: "pending", // pending → processing → completed/failed
      ledgerEntry: reserved.entry._id,
    });

    res.status(201).json({
      message: "Payout request submitted successfully",
      payout: {
        payoutId: payout._id,
        amount: payout.amount,
        status: payout.status,
        requestedAt: payout.createdAt,
      },
      updatedBalance: {
        availableBalance: reserved.availableBalance,
        pendingBalance: reserved.pendingBalance,
      },
    });
  } catch (error) {
    console.error("Payout request error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get pending payout requests
 * GET /api/payouts/pending
 */
const getPendingPayouts = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.role;

    if (!["rider", "vendor"].includes(userType)) {
      return res.status(403).json({ error: "Only riders and vendors can view payouts" });
    }

    const payouts = await Payout.find({
      user: userId,
      status: { $in: ["pending", "processing"] },
    }).sort({ createdAt: -1 });

    res.json(payouts);
  } catch (error) {
    console.error("Pending payouts fetch error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Cancel a payout request (admin or user)
 * PUT /api/payouts/:payoutId/cancel
 * Reverses the reservation and moves balance back to available
 */
const cancelPayout = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const userId = req.user.id;

    const payout = await Payout.findById(payoutId);
    if (!payout) {
      return res.status(404).json({ error: "Payout not found" });
    }

    // Check authorization
    if (payout.user.toString() !== userId && req.user.role !== "admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (payout.status !== "pending") {
      return res.status(400).json({
        error: `Cannot cancel payout with status: ${payout.status}`,
      });
    }

    // Reverse the reservation
    const reversed = await ledgerService.reverseReserve(
      payout.user,
      payout.userType,
      payout.amount,
      "Payout request cancelled by user"
    );

    // Update payout record
    payout.status = "cancelled";
    await payout.save();

    res.json({
      message: "Payout request cancelled",
      payout,
      updatedBalance: {
        availableBalance: reversed.availableBalance,
        pendingBalance: reversed.pendingBalance,
      },
    });
  } catch (error) {
    console.error("Cancel payout error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Process payout (admin endpoint)
 * PUT /api/payouts/:payoutId/process
 * Transfers money from pending balance to external bank account
 * Called after verifying successful bank transfer
 */
const processPayout = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { transactionRef, status = "completed" } = req.body;



    // Admin check
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Only admins can process payouts" });
    }

    const payout = await Payout.findById(payoutId);
    if (!payout) {
      return res.status(404).json({ error: "Payout not found" });
    }

    if (payout.status !== "pending" && payout.status !== "processing") {
      return res.status(400).json({
        error: `Cannot process payout with status: ${payout.status}`,
      });
    }

    if (status === "failed") {
      // Reverse the reservation if transfer failed
      const reversed = await ledgerService.reverseReserve(
        payout.user,
        payout.userType,
        payout.amount,
        `Payout processing failed: ${transactionRef}`
      );

      payout.status = "failed";
      payout.transactionRef = transactionRef;
      payout.processedAt = new Date();
      await payout.save();

      return res.json({
        message: "Payout marked as failed and balance reversed",
        payout,
        updatedBalance: {
          availableBalance: reversed.availableBalance,
          pendingBalance: reversed.pendingBalance,
        },
      });
    }

    // Debit from pending balance (money leaves system)
    const completed = await ledgerService.completePayout(
      payout.user,
      payout.userType,
      payout.amount
    );

    // Update payout record
    payout.status = "completed";
    payout.transactionRef = transactionRef;
    payout.processedAt = new Date();
    await payout.save();

    res.json({
      message: "Payout processed successfully",
      payout,
      updatedBalance: {
        availableBalance: (await ledgerService.getAccountBalance(payout.user, payout.userType)).availableBalance,
        pendingBalance: completed.pendingBalance,
      },
    });
  } catch (error) {
    console.error("Process payout error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Admin: Retry a pending/failed payout by id
 * POST /api/payouts/:payoutId/retry
 */
const retryPayout = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Only admins can retry payouts" });
    const { payoutId } = req.params;
    const result = await payoutService.processPendingPayout(payoutId);
    if (result && result.success) return res.json({ message: "Payout retried successfully", result });
    return res.status(400).json({ message: "Payout retry failed", result });
  } catch (error) {
    console.error('Retry payout error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/payouts/history
 * Fetch withdrawal history for the logged-in Vendor or Rider
 */
const getPayoutHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    // We identify the user by req.user (from your auth middleware)
    const query = { 
      user: req.user.id, 
      userType: req.user.role // Assuming role is 'VENDOR' or 'RIDER'
    };

    const history = await Payout.find(query)
      .sort({ createdAt: -1 }) // Newest first
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const count = await Payout.countDocuments(query);

    res.json({
      success: true,
      data: history,
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        currentPage: page
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get account statement (for reconciliation)
 * GET /api/payouts/statement?startDate=2025-01-01&endDate=2025-12-31
 */
const getStatement = async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.role;
    const { startDate, endDate } = req.query;

    if (!["rider", "vendor"].includes(userType)) {
      return res.status(403).json({ error: "Only riders and vendors can view statements" });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate required (YYYY-MM-DD format)" });
    }

    const statement = await ledgerService.getAccountStatement(
      userId,
      userType.toUpperCase(),
      new Date(startDate),
      new Date(endDate)
    );

    res.json(statement);
  } catch (error) {
    console.error("Statement fetch error:", error.message);
    res.status(500).json({ error: error.message });
  }
};


module.exports = {
  getBalance,
  getTransactionHistory,
  requestPayout,
  getPendingPayouts,
  cancelPayout,
  processPayout,
  retryPayout,
  getStatement,
  getPayoutHistory,
};
