// routes/dvaRoutes.js

const express = require("express");
const router = express.Router();
const axios = require("axios");
const { authMiddleware } = require("../middleware/auth");
const { getOrCreateDVA, provisionDVA } = require("../controllers/dvaController");
const { Customer } = require("../models");

// ── Paystack client (same config as dva.service.js) ──────────────────────────
const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
});

const PREFERRED_BANK =
	process.env.NODE_ENV === "production" ? "titan-paystack" : "test-bank";

router.get("/account", authMiddleware, getOrCreateDVA);
router.post("/provision", authMiddleware, provisionDVA);

/**
 * GET /api/dva/debug
 *
 * Returns a full diagnostic snapshot for the current customer:
 *   - DB customer document (titanAccount, paystackCustomerCode, phone, email)
 *   - Raw Paystack customer lookup (if customerCode exists)
 *   - Raw Paystack DVA lookup
 *   - Any errors from each step
 *
 * Use this to diagnose why a specific user cannot see their virtual account.
 */
router.get("/debug", authMiddleware, async (req, res) => {
	const debug = {
		userId: req.user.id,
		role: req.user.role,
		env: {
			NODE_ENV: process.env.NODE_ENV,
			PREFERRED_BANK,
			PAYSTACK_KEY_PREFIX: process.env.PAYSTACK_SECRET_KEY
				? process.env.PAYSTACK_SECRET_KEY.substring(0, 8) + "..."
				: "NOT SET",
		},
		db: null,
		paystack_customer: null,
		paystack_dva: null,
		errors: [],
	};

	// ── Step 1: Load customer from DB ────────────────────────────────────────
	try {
		const customer = await Customer.findOne({ user: req.user.id }).populate("user");
		if (!customer) {
			debug.errors.push("No Customer document found for this userId");
			return res.status(200).json({ success: false, debug });
		}

		debug.db = {
			customerId: customer._id,
			paystackCustomerCode: customer.paystackCustomerCode || null,
			titanAccount: customer.titanAccount || null,
			firstName: customer.firstName || null,
			lastName: customer.lastName || null,
			phone_on_customer: customer.phone || null,
			phone_on_user: customer.user?.phone || null,
			email_on_user: customer.user?.email || null,
			user_name: customer.user?.name || null,
		};

		// ── Step 2: Paystack customer lookup ─────────────────────────────────
		const lookupKey = customer.paystackCustomerCode || customer.user?.email;
		if (!lookupKey) {
			debug.errors.push("No paystackCustomerCode and no email — cannot look up Paystack customer");
		} else {
			try {
				const { data } = await paystack.get(`/customer/${lookupKey}`);
				const pc = data.data;
				debug.paystack_customer = {
					customer_code: pc.customer_code,
					email: pc.email,
					phone: pc.phone,
					identified: pc.identified,
					integration: pc.integration,
					dedicated_account: pc.dedicated_account || null,
				};

				// ── Step 3: DVA detail from the customer response ─────────────
				if (pc.dedicated_account) {
					debug.paystack_dva = {
						source: "embedded_in_customer",
						account_number: pc.dedicated_account.account_number,
						account_name: pc.dedicated_account.account_name,
						bank: pc.dedicated_account.bank,
						active: pc.dedicated_account.active,
					};
				} else {
					debug.errors.push("Paystack customer exists but has NO dedicated_account");

					// Try fetching the DVA separately via /dedicated_account
					try {
						const { data: dvaData } = await paystack.get(
							`/dedicated_account?customer=${pc.customer_code}`,
						);
						debug.paystack_dva = {
							source: "dedicated_account_endpoint",
							raw: dvaData.data,
						};
					} catch (dvaErr) {
						debug.errors.push(
							`/dedicated_account fetch failed: ${dvaErr.response?.data?.message || dvaErr.message}`,
						);
					}
				}
			} catch (psErr) {
				debug.errors.push(
					`Paystack customer lookup failed for "${lookupKey}": ${psErr.response?.data?.message || psErr.message}`,
				);
			}
		}
	} catch (dbErr) {
		debug.errors.push(`DB error: ${dbErr.message}`);
	}

	return res.status(200).json({ success: true, debug });
});

module.exports = router;