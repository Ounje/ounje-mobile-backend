const axios = require("axios");
const logger = require("./logger");

const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
		"Content-Type": "application/json",
	},
});

async function safeRequest(promise, label = "Paystack") {
	try {
		const res = await promise;
		logger.info(`[${label}] ✅ Success | status=${res.status}`);
		logger.debug(`[${label}] Response: ${JSON.stringify(res.data)}`);
		return res.data;
	} catch (err) {
		const paystackError = err.response?.data;
		logger.error(
			`[${label}] ❌ Failed | status=${err.response?.status} | message=${paystackError?.message || err.message}`,
		);
		logger.debug(
			`[${label}] Full error payload: ${JSON.stringify(paystackError)}`,
		);
		throw new Error(paystackError?.message || "Paystack API Error");
	}
}

exports.transaction = {
	initialize: async (payload) => {
		logger.info(
			`[Paystack.transaction.initialize] email=${payload.email} amount=${payload.amount} ref=${payload.reference}`,
		);
		return safeRequest(
			paystack.post("/transaction/initialize", payload),
			"transaction.initialize",
		);
	},

	verify: async (reference) => {
		logger.info(`[Paystack.transaction.verify] reference=${reference}`);
		return safeRequest(
			paystack.get(`/transaction/verify/${reference}`),
			"transaction.verify",
		);
	},
};

exports.bank = {
	list: async () => {
		logger.info(`[Paystack.bank.list] Fetching bank list`);
		return safeRequest(paystack.get("/bank"), "bank.list");
	},

	resolveAccount: async (account_number, bank_code) => {
		logger.info(
			`[Paystack.bank.resolveAccount] account=${account_number} bank_code=${bank_code}`,
		);
		return safeRequest(
			paystack.get(
				`/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
			),
			"bank.resolveAccount",
		);
	},
};

exports.recipients = {
	create: async ({ name, account_number, bank_code }) => {
		logger.info(
			`[Paystack.recipients.create] name=${name} account=${account_number} bank_code=${bank_code}`,
		);
		const result = await safeRequest(
			paystack.post("/transferrecipient", {
				type: "nuban",
				name,
				account_number,
				bank_code,
			}),
			"recipients.create",
		);
		logger.info(
			`[Paystack.recipients.create] recipient_code=${result?.data?.recipient_code}`,
		);
		return result;
	},
};

exports.transfer = {
	initiate: async ({
		amount,
		recipient,
		reason,
		reference,
		idempotencyKey,
	}) => {
		logger.info(
			`[Paystack.transfer.initiate] recipient=${recipient} amount=${amount} reference=${reference} reason="${reason}"`,
		);
		if (!reference)
			logger.warn(
				`[Paystack.transfer.initiate] ⚠️ No reference provided — idempotency not guaranteed`,
			);
		if (!recipient)
			logger.error(
				`[Paystack.transfer.initiate] ❌ recipient is missing — transfer will fail`,
			);

		const result = await safeRequest(
			paystack.post(
				"/transfer",
				{
					source: "balance",
					amount,
					recipient,
					reason,
					reference,
					currency: "NGN",
				},
				idempotencyKey
					? { headers: { "Idempotency-Key": idempotencyKey } }
					: {},
			),
			"transfer.initiate",
		);
		logger.info(
			`[Paystack.transfer.initiate] transfer_code=${result?.data?.transfer_code} status=${result?.data?.status}`,
		);
		return result;
	},

	finalize: async ({ transfer_code, otp }) => {
		logger.info(`[Paystack.transfer.finalize] transfer_code=${transfer_code}`);
		return safeRequest(
			paystack.post("/transfer/finalize_transfer", { transfer_code, otp }),
			"transfer.finalize",
		);
	},
};

exports.customer = {
	create: async ({ email, first_name, last_name, phone }) => {
		logger.info(`[Paystack.customer.create] email=${email}`);
		return safeRequest(
			paystack.post("/customer", { email, first_name, last_name, phone }),
			"customer.create",
		);
	},

	fetch: async (customerCode) => {
		logger.info(`[Paystack.customer.fetch] customerCode=${customerCode}`);
		return safeRequest(
			paystack.get(`/customer/${customerCode}`),
			"customer.fetch",
		);
	},
};

exports.dedicatedAccount = {
	assign: async ({
		customer,
		first_name,
		last_name,
		phone,
		preferred_bank = "titan-paystack",
	}) => {
		logger.info(
			`[Paystack.dedicatedAccount.assign] customer=${customer} bank=${preferred_bank}`,
		);
		return safeRequest(
			paystack.post("/dedicated_account/assign", {
				customer,
				first_name,
				last_name,
				phone,
				preferred_bank,
				country: "NG",
			}),
			"dedicatedAccount.assign",
		);
	},

	fetch: async (accountNumber) => {
		logger.info(
			`[Paystack.dedicatedAccount.fetch] accountNumber=${accountNumber}`,
		);
		return safeRequest(
			paystack.get(`/dedicated_account/${accountNumber}`),
			"dedicatedAccount.fetch",
		);
	},

	deactivate: async (dedicatedAccountId) => {
		logger.info(
			`[Paystack.dedicatedAccount.deactivate] id=${dedicatedAccountId}`,
		);
		return safeRequest(
			paystack.delete(`/dedicated_account/${dedicatedAccountId}`),
			"dedicatedAccount.deactivate",
		);
	},
};
