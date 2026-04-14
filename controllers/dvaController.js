// controllers/dvaController.js
//
// Exposes two endpoints:
//   GET  /api/dva/account        — return the customer's Titan account (create if missing)
//   POST /api/dva/provision      — explicitly trigger provisioning (call from registration)

const { Customer } = require("../models");
const { provisionCustomerDVA } = require("../services/dva.service");

/**
 * GET /api/dva/account
 *
 * Returns the logged-in customer's Titan virtual account.
 * Creates one automatically on first call (idempotent — safe to call on every login).
 *
 * Flow:
 *   1. Load customer + user from DB
 *   2. If titanAccount already saved → return it immediately (no Paystack call)
 *   3. Otherwise → call Paystack, save result, return it
 */
const getOrCreateDVA = async (req, res) => {
  try {
    const userId = req.user.id;

    const customer = await Customer.findOne({ user: userId }).populate("user");
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    // ── Fast path: account already exists in DB ──────────────────────
    if (customer.titanAccount?.accountNumber) {
      return res.status(200).json({
        success: true,
        titanAccount: customer.titanAccount,
      });
    }

    // ── Slow path: provision for the first time ───────────────────────
    const { customerCode, titanAccount } = await provisionCustomerDVA(customer);

    // Persist to DB
    customer.paystackCustomerCode = customerCode;
    customer.titanAccount = titanAccount;
    await customer.save();

    return res.status(200).json({
      success: true,
      titanAccount,
    });
  } catch (err) {
    console.error("DVA getOrCreate error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Could not provision virtual account",
    });
  }
};

/**
 * POST /api/dva/provision
 *
 * Explicit provisioning — useful to call right after customer registration
 * so the account is ready before the user's first login.
 * Idempotent: safe to call even if the account was already created.
 */
const provisionDVA = async (req, res) => {
  // Reuse the same logic — just POST instead of GET
  return getOrCreateDVA(req, res);
};

module.exports = { getOrCreateDVA, provisionDVA };