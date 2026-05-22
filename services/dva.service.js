// services/dva.service.js

const axios = require("axios");

const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
});

const PREFERRED_BANK =
	process.env.NODE_ENV === "production" ? "titan-paystack" : "test-bank";

/**
 * ─────────────────────────────────────────────
 * NORMALIZERS (CRITICAL FIX)
 * ─────────────────────────────────────────────
 */

function normalizePhone(phone) {
	if (!phone) return "";

	if (typeof phone === "number") return String(phone);

	if (typeof phone === "string") return phone;

	if (typeof phone === "object") {
		return phone.number || phone.phone || "";
	}

	return "";
}

function extractNameParts(user) {
	const fullName = user?.name || "Customer User";
	const parts = fullName.trim().split(" ");

	return {
		firstName: parts[0] || "Customer",
		lastName: parts.length > 1 ? parts.slice(1).join(" ") : "User",
	};
}

/**
 * ─────────────────────────────────────────────
 * PAYSTACK CUSTOMER CREATION
 * ─────────────────────────────────────────────
 */

async function createPaystackCustomer({ email, firstName, lastName, phone }) {
	if (!email) throw new Error("Email is required for Paystack customer");

	try {
		const { data } = await paystack.post("/customer", {
			email,
			first_name: firstName,
			last_name: lastName,
			phone,
		});

		const created = data.data;

		// Paystack silently drops the phone on customer creation — patch it explicitly.
		await paystack
			.put(`/customer/${created.customer_code}`, { phone })
			.catch(() => null);

		return created;
	} catch (err) {
		if (err.response?.status === 422) {
			// Customer already exists — fetch their record then ensure phone is set
			const { data } = await paystack.get(`/customer/${email}`);
			const existing = data.data;

			await paystack
				.put(`/customer/${existing.customer_code}`, { phone })
				.catch(() => null);

			return existing;
		}

		throw new Error(
			err.response?.data?.message || "Failed to create Paystack customer",
		);
	}
}

/**
 * ─────────────────────────────────────────────
 * TITAN VIRTUAL ACCOUNT CREATION
 * ─────────────────────────────────────────────
 */

const logger = require("../utils/logger");

async function createTitanVirtualAccount(customerCode) {
	try {
		const { data } = await paystack.post("/dedicated_account", {
			customer: customerCode,
			preferred_bank: PREFERRED_BANK,
		});
		logger.info(`[DVA] Created new dedicated account for Paystack customer ${customerCode}`);
		return data.data;
	} catch (err) {
		const paystackMsg = err.response?.data?.message || "";
		logger.warn(`[DVA] createTitanVirtualAccount failed for ${customerCode}: "${paystackMsg}" (status ${err.response?.status})`);

		// Regardless of why creation failed (duplicate, config issue, etc.),
		// always try to fetch an existing DVA for this customer before giving up.
		try {
			const existing = await fetchCustomerDVA(customerCode);
			if (existing?.account_number) {
				logger.info(`[DVA] Recovered existing DVA ${existing.account_number} for customer ${customerCode}`);
				return existing;
			}
		} catch (fetchErr) {
			logger.error(`[DVA] fetchCustomerDVA also failed for ${customerCode}: ${fetchErr.message}`);
		}

		throw new Error(paystackMsg || "Failed to create Titan virtual account");
	}
}

/**
 * ─────────────────────────────────────────────
 * OPTIONAL FALLBACK FETCH
 * ─────────────────────────────────────────────
 */

async function fetchCustomerDVA(customerCode) {
	const { data } = await paystack.get(`/customer/${customerCode}`);
	const account = data.data.dedicated_account || null;
	if (!account) {
		logger.warn(`[DVA] fetchCustomerDVA: no dedicated_account found for ${customerCode}. Full response keys: ${Object.keys(data.data || {}).join(", ")}`);
	}
	return account;
}


/**
 * ─────────────────────────────────────────────
 * MAIN PROVISIONING FUNCTION
 * ─────────────────────────────────────────────
 */

async function provisionCustomerDVA(customer) {
	const user = customer?.user;

	if (!user) {
		throw new Error("Customer user not populated");
	}

	// Resolve and validate phone upfront — needed for both new and existing customers
	const rawPhone = customer.phone || user.phone;
	const localPhone = normalizePhone(rawPhone);

	if (!localPhone) {
		throw new Error("PHONE_REQUIRED");
	}

	// Paystack stores and validates phone most reliably in local Nigerian format (0XXXXXXXXXX).
	// Strip any leading zeros or +234 prefix, then re-add a single leading 0.
	const digits = localPhone.replace(/^\+?234/, "").replace(/^0+/, "");
	const phone = `0${digits}`;

	// Paystack requires an email address to create a customer record.
	// For customers who registered with phone only (no email), we generate a
	// stable synthetic email from their normalised phone number so they can
	// still receive a DVA.  The domain is internal-only and never used for
	// real communication.
	const email = user.email || `${digits}@wallet.ounje.app`;

	// 1. Ensure Paystack customer exists and has phone set.
	// Always go through createPaystackCustomer so the 422 handler runs
	// and patches the phone on any pre-existing customer record.
	const { firstName, lastName } = extractNameParts(user);

	const paystackCustomer = await createPaystackCustomer({
		email,
		firstName,
		lastName,
		phone,
	});

	const customerCode = paystackCustomer.customer_code;

	// 2. Create virtual account
	const dva = await createTitanVirtualAccount(customerCode);

	// 3. Normalize response
	const titanAccount = {
		accountNumber: dva.account_number,
		accountName: dva.account_name,
		bankName: dva.bank?.name || "Titan Paystack",
		bankSlug: dva.bank?.slug || "titan-paystack",
	};

	return {
		customerCode,
		titanAccount,
	};
}

async function refundTransaction(reference, amountKobo) {
	try {
		const { data } = await paystack.post("/refund", {
			transaction: reference,
			amount: amountKobo,
		});
		return data.data;
	} catch (err) {
		throw new Error(
			err.response?.data?.message || "Failed to issue Paystack refund",
		);
	}
}

module.exports = {
	createPaystackCustomer,
	createTitanVirtualAccount,
	fetchCustomerDVA,
	provisionCustomerDVA,
	refundTransaction,
};
