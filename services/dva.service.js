// services/dva.service.js
//
// Handles Paystack-Titan Dedicated Virtual Account (DVA) creation.
// The pattern is: create ONCE on first registration/login, retrieve always.
// Never call createCustomerDVA more than once per customer.

const axios = require("axios");

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

// In test mode Paystack rejects 'titan-paystack' — use 'test-bank' instead.
const PREFERRED_BANK =
  process.env.NODE_ENV === "production" ? "titan-paystack" : "test-bank";

/**
 * Step A: Create a Paystack customer record.
 * Required before you can issue a virtual account.
 * Returns the full customer object including customer_code.
 */
async function createPaystackCustomer({ email, firstName, lastName, phone }) {
  try {
    const { data } = await paystack.post("/customer", {
      email,
      first_name: firstName,
      last_name: lastName,
      phone, // e.g. '08012345678' or '+2348012345678'
    });
    return data.data; // { customer_code: 'CUS_xxx', email, ... }
  } catch (err) {
    // Paystack returns 422 if a customer with that email already exists.
    // Fetch the existing record instead of failing.
    if (err.response?.status === 422) {
      const { data } = await paystack.get(`/customer/${email}`);
      return data.data;
    }
    throw new Error(
      err.response?.data?.message || "Failed to create Paystack customer"
    );
  }
}

/**
 * Step B: Create the Paystack-Titan dedicated virtual account.
 * Returns account_number, account_name, and bank details.
 */
async function createTitanVirtualAccount(customerCode) {
  try {
    const { data } = await paystack.post("/dedicated_account", {
      customer: customerCode,      // 'CUS_xxx'
      preferred_bank: PREFERRED_BANK, // 'titan-paystack' in prod, 'test-bank' in dev
    });
    return data.data;
    // {
    //   account_number: '9012345678',
    //   account_name:   'YourApp/John Doe',
    //   bank: { name: 'Titan Paystack', slug: 'titan-paystack', id: 100 }
    // }
  } catch (err) {
    throw new Error(
      err.response?.data?.message || "Failed to create Titan virtual account"
    );
  }
}

/**
 * Convenience: fetch a customer's existing DVA from Paystack
 * (optional — your DB is the source of truth; use this only as a fallback).
 */
async function fetchCustomerDVA(customerCode) {
  const { data } = await paystack.get(`/customer/${customerCode}`);
  return data.data.dedicated_account || null;
}

/**
 * Main entry point called by your registration / login flow.
 *
 * Expects a Customer document that has already been populated with its
 * linked User (customer.user must have firstName, lastName, email, phone).
 *
 * Returns the titanAccount object to be saved to the Customer document.
 */
async function provisionCustomerDVA(customer) {
  const user = customer.user; // populated User document

  // ── 1. Ensure Paystack customer record exists ──────────────────────
  let customerCode = customer.paystackCustomerCode;

  if (!customerCode) {
    const paystackCustomer = await createPaystackCustomer({
      email: user.email,
      firstName: user.firstName || user.name?.split(" ")[0] || "Customer",
      lastName:
        user.lastName ||
        user.name?.split(" ").slice(1).join(" ") ||
        "User",
      phone: user.phone || "",
    });
    customerCode = paystackCustomer.customer_code;
  }

  // ── 2. Create the Titan virtual account ───────────────────────────
  const dva = await createTitanVirtualAccount(customerCode);

  const titanAccount = {
    accountNumber: dva.account_number,
    accountName:   dva.account_name,
    bankName:      dva.bank?.name || "Titan Paystack",
    bankSlug:      dva.bank?.slug || "titan-paystack",
  };

  return { customerCode, titanAccount };
}

module.exports = {
  createPaystackCustomer,
  createTitanVirtualAccount,
  fetchCustomerDVA,
  provisionCustomerDVA,
};