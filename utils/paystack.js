const axios = require("axios");

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    // Use TEST key consistently (replace with production key for prod env)
    Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

async function safeRequest(promise) {
  try {
    const res = await promise;
    return res.data;
  } catch (err) {
    console.error("Paystack Error:", err.response?.data || err.message);
    throw new Error(err.response?.data?.message || "Paystack API Error");
  }
}

exports.transaction= {
    initialize: async (payload) =>
        safeRequest(paystack.post("/transaction/initialize", payload)),

    verify: async (reference) =>
        safeRequest(paystack.get(`/transaction/verify/${reference}`)),
}

exports.bank= {
    list: async () => safeRequest(paystack.get("/bank")),

    resolveAccount: async (account_number, bank_code) =>
      safeRequest(
        paystack.get(
          `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`
        )
    ),
}

exports.recipients= {
    create: async ({ name, account_number, bank_code }) =>
      safeRequest(
        paystack.post("/transferrecipient", {
          type: "nuban",
          name,
          account_number,
          bank_code,
        })
    ),
}

// Transfers: accept optional idempotencyKey and set it as Idempotency-Key header
exports.transfer= {
    initiate: async ({ amount, recipient, reason, idempotencyKey }) =>
      safeRequest(
        paystack.post(
          "/transfer",
          {
            amount, // must be in kobo
            recipient,
            reason,
          },
          idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}
        )
      ),

    finalize: async ({ transferCode, otp }) =>
      safeRequest(
        paystack.post("/transfer/finalize_transfer", {
          transferCode,
          otp,
        })
    ),
}

// module.exports = {
//   transaction: {
//     initialize: async (payload) =>
//       safeRequest(paystack.post("/transaction/initialize", payload)),

//     verify: async (reference) =>
//       safeRequest(paystack.get(`/transaction/verify/${reference}`)),
//   },


//   bank: {
//     list: async () => safeRequest(paystack.get("/bank")),

//     resolveAccount: async (account_number, bank_code) =>
//       safeRequest(
//         paystack.get(
//           `/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`
//         )
//       ),
//   },

//   /**
//    * === TRANSFER RECIPIENTS ===
//    */
//   recipients: {
//     create: async ({ name, account_number, bank_code }) =>
//       safeRequest(
//         paystack.post("/transferrecipient", {
//           type: "nuban",
//           name,
//           account_number,
//           bank_code,
//         })
//       ),
//   },

//   /**
//    * === TRANSFERS (For vendor & rider payouts) ===
//    */
//   transfer: {
//     initiate: async ({ amount, recipient, reason }) =>
//       safeRequest(
//         paystack.post("/transfer", {
//           amount, // must be in kobo
//           recipient,
//           reason,
//         })
//       ),

//     finalize: async ({ transfer_code, otp }) =>
//       safeRequest(
//         paystack.post("/transfer/finalize_transfer", {
//           transfer_code,
//           otp,
//         })
//       ),
//   },
// };
