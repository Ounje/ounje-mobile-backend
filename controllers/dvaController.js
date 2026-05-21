// controllers/dvaController.js
//
// Exposes two endpoints:
//   GET  /api/dva/account        — return the customer's Titan account (create if missing)
//   POST /api/dva/provision      — explicitly trigger provisioning (call from registration)

const { Customer } = require("../models");
const { provisionCustomerDVA, fetchCustomerDVA, createPaystackCustomer } = require("../services/dva.service");
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
		try {
			const { customerCode, titanAccount } = await provisionCustomerDVA(customer);

			// Persist to DB
			customer.paystackCustomerCode = customerCode;
			customer.titanAccount = titanAccount;
			await customer.save();

			return res.status(200).json({
				success: true,
				titanAccount,
			});
		} catch (provisionErr) {
			// PHONE_REQUIRED: customer registered without a phone number.
			// Return a 422 with a clear error code so the frontend shows the
			// "Add your phone number" prompt instead of a generic error banner.
			if (provisionErr.message === "PHONE_REQUIRED") {
				return res.status(422).json({
					success: false,
					code: "PHONE_REQUIRED",
					error: "A phone number is required to create a virtual account. Please add one to your profile.",
				});
			}

			// Recovery path: DVA already exists on Paystack's side but was never
			// saved to our DB (e.g. setImmediate in authController ran but the
			// DB write failed, or the server restarted mid-provisioning).
			// Try to fetch the existing account directly from Paystack.
			const isAlreadyExists =
				provisionErr.message?.toLowerCase().includes("already") ||
				provisionErr.message?.toLowerCase().includes("exist");

			if (isAlreadyExists && customer.user?.email) {
				try {
					logger.info(`[DVA] Attempting Paystack recovery fetch for customer ${customer._id}`);

					// Ensure we have the Paystack customer code
					let customerCode = customer.paystackCustomerCode;
					if (!customerCode) {
						const paystackCustomer = await createPaystackCustomer({
							email: customer.user.email,
							firstName: customer.firstName || customer.user?.name?.split(" ")[0] || "Customer",
							lastName: customer.lastName || customer.user?.name?.split(" ").slice(1).join(" ") || "User",
							phone: customer.user.phone || customer.phone || "",
						});
						customerCode = paystackCustomer.customer_code;
						customer.paystackCustomerCode = customerCode;
					}

					const existingDva = await fetchCustomerDVA(customerCode);
					if (existingDva?.account_number) {
						const titanAccount = {
							accountNumber: existingDva.account_number,
							accountName: existingDva.account_name,
							bankName: existingDva.bank?.name || "Titan Paystack",
							bankSlug: existingDva.bank?.slug || "titan-paystack",
						};
						customer.titanAccount = titanAccount;
						await customer.save();

						logger.info(`[DVA] Recovered existing DVA for customer ${customer._id}`);
						return res.status(200).json({ success: true, titanAccount });
					}
				} catch (recoveryErr) {
					logger.error(`[DVA] Recovery fetch failed for customer ${customer._id}: ${recoveryErr.message}`);
				}
			}

			// Re-throw so the outer catch handles it as a generic 500
			throw provisionErr;
		}
	} catch (err) {
		logger.error(`DVA getOrCreate error for user ${req.user?.id}: ${err.message}`);

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
