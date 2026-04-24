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

	console.log("[DVA] createPaystackCustomer — phone sent to Paystack:", phone);

	try {
		const { data } = await paystack.post("/customer", {
			email,
			first_name: firstName,
			last_name: lastName,
			phone,
		});

		console.log("[DVA] Paystack customer created — phone on record:", data.data?.phone);
		return data.data;
	} catch (err) {
		if (err.response?.status === 422) {
			// Customer already exists — fetch their record then ensure phone is set
			const { data } = await paystack.get(`/customer/${email}`);
			const existing = data.data;

			console.log("[DVA] Existing customer phone before patch:", existing.phone);

			const patchRes = await paystack
				.put(`/customer/${existing.customer_code}`, { phone })
				.catch((patchErr) => {
					console.error(
						"[DVA] phone patch failed:",
						patchErr.response?.data?.message || patchErr.message,
					);
					return null;
				});

			console.log("[DVA] Patch response phone:", patchRes?.data?.data?.phone);

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

async function createTitanVirtualAccount(customerCode) {
	try {
		const { data } = await paystack.post("/dedicated_account", {
			customer: customerCode,
			preferred_bank: PREFERRED_BANK,
		});

		return data.data;
	} catch (err) {
		throw new Error(
			err.response?.data?.message || "Failed to create Titan virtual account",
		);
	}
}

/**
 * ─────────────────────────────────────────────
 * OPTIONAL FALLBACK FETCH
 * ─────────────────────────────────────────────
 */

async function fetchCustomerDVA(customerCode) {
	const { data } = await paystack.get(`/customer/${customerCode}`);
	return data.data.dedicated_account || null;
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

	console.log("[DVA] rawPhone:", rawPhone, "| type:", typeof rawPhone, "| localPhone:", localPhone);

	if (!localPhone) {
		throw new Error("PHONE_REQUIRED");
	}

	const phone = localPhone.startsWith("+")
		? localPhone
		: `+234${localPhone.replace(/^0+/, "")}`;

	console.log("[DVA] formatted phone for Paystack:", phone);

	// 1. Ensure Paystack customer exists and has phone set.
	// Always go through createPaystackCustomer so the 422 handler runs
	// and patches the phone on any pre-existing customer record.
	const { firstName, lastName } = extractNameParts(user);

	const paystackCustomer = await createPaystackCustomer({
		email: user.email,
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
