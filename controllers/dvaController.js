// controllers/dvaController.js
//
// Exposes two endpoints:
//   GET  /api/dva/account        — return the customer's Titan account (create if missing)
//   POST /api/dva/provision      — explicitly trigger provisioning (call from registration)

const { Customer } = require("../models");
const { provisionCustomerDVA } = require("../services/dva.service");
const logger = require("../utils/logger");

/**
 * GET /api/dva/account
 *
 * Returns the logged-in customer's Titan virtual account.
 * Creates one automatically on first call (idempotent — safe to call on every login).
 *
 * Flow:
 *   1. Load customer + user from DB
 *   2. If titanAccount already saved → return it immediately (no Paystack call)
 *   3. Otherwise → call Paystack to provision, save result, return it
 *   4. If provisioning fails because DVA already exists on Paystack's side,
 *      fetch it from Paystack and save to DB (recovery path for stale registrations)
 */
const getOrCreateDVA = async (req, res) => {
	try {
		const userId = req.user.id;

		const customer = await Customer.findOne({ user: userId }).populate("user");
		if (!customer) {
			return res
				.status(404)
				.json({ success: false, error: "Customer not found" });
		}

		// ── Fast path: account already exists in DB ──────────────────────
		if (customer.titanAccount?.accountNumber) {
			return res.status(200).json({
				success: true,
				titanAccount: customer.titanAccount,
			});
		}

		// ── Slow path: provision for the first time ───────────────────────
		// provisionCustomerDVA internally auto-recovers if the customer or DVA
		// already exists on Paystack's side (see dva.service.js).
		const { customerCode, titanAccount } = await provisionCustomerDVA(customer);

		customer.paystackCustomerCode = customerCode;
		customer.titanAccount = titanAccount;
		await customer.save();

		return res.status(200).json({ success: true, titanAccount });
	} catch (err) {
		logger.error(`DVA getOrCreate error for user ${req.user?.id}: ${err.message}`);

		if (err.message === "PHONE_REQUIRED") {
			return res.status(422).json({
				success: false,
				code: "PHONE_REQUIRED",
				error: "A phone number is required to create a virtual account. Please add one to your profile.",
			});
		}

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
