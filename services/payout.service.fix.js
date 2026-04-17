const processPendingPayout = async (payoutId) => {
	const payout = await Payout.findById(payoutId);

	if (!payout) {
		throw new Error(`processPendingPayout: payout ${payoutId} not found`);
	}

	if (payout.status !== "pending") {
		logger.warn(
			`processPendingPayout: payout ${payoutId} has status '${payout.status}', skipping`,
		);
		return { success: false, reason: "not_pending", payout };
	}

	const { user: userId, userType, amount, bankDetails } = payout;

	if (!bankDetails?.accountNumber || !bankDetails?.bankCode) {
		logger.warn(
			`processPendingPayout: payout ${payoutId} still has no bank details`,
		);
		return { success: false, reason: "no_bank", payout };
	}

	const fees = calculateTotalFees(amount);
	const netAmount = amount - fees.total;

	if (netAmount <= 0) {
		payout.status = "failed";
		payout.failureReason = `Amount NGN ${amount} cannot cover fees of NGN ${fees.total}`;
		await payout.save();
		return { success: false, reason: "amount_too_low", payout };
	}

	// Track whether THIS call reserved — so we know whether to reverse on failure
	let thisCallReserved = false;
	let ledgerEntryId = payout.ledgerEntry;

	if (!ledgerEntryId) {
		try {
			const reserved = await ledgerService.reserveBalance(
				userId,
				userType,
				amount,
			);
			ledgerEntryId = reserved.entry._id;
			thisCallReserved = true;

			payout.ledgerEntry = ledgerEntryId;
			payout.feeDeducted = fees.total;
			payout.netAmount = netAmount;
			await payout.save();
		} catch (err) {
			logger.error(
				`processPendingPayout: ledger reserve failed for ${payoutId}:`,
				err.message,
			);
			return { success: false, reason: "insufficient_funds", payout };
		}
	} else {
		logger.info(
			`processPendingPayout: ledgerEntry already exists for ${payoutId}, skipping reserve`,
		);
	}

	try {
		const model = userType === "VENDOR" ? VendorProfile : RiderProfile;
		const profile = await model.findOne({ user: userId });
		if (!profile)
			throw new Error(`${userType} profile not found for userId ${userId}`);

		let recipientCode;
		if (profile.paystackRecipientCode) {
			recipientCode = profile.paystackRecipientCode;
		} else {
			const recipient = await paystack.recipients.create({
				name: profile.name || "Recipient",
				account_number: bankDetails.accountNumber,
				bank_code: bankDetails.bankCode,
			});
			recipientCode = recipient?.data?.recipient_code;
			if (!recipientCode) throw new Error("Failed to get recipient code");
			profile.paystackRecipientCode = recipientCode;
			await profile.save();
		}

		const stableKey = payout.idempotencyKey ?? `payout_pending_${payoutId}`;

		if (!payout.idempotencyKey) {
			payout.idempotencyKey = stableKey;
			await payout.save();
		}

		const transfer = await paystack.transfer.initiate({
			amount: Math.round(netAmount * 100),
			recipient: recipientCode,
			reason: "Wallet Withdrawal",
			reference: stableKey,
		});

		const transferCode = transfer?.data?.transfer_code;
		if (!transferCode)
			throw new Error("No transfer_code returned from Paystack");

		payout.status = "processing";
		payout.transactionRef = transferCode;
		await payout.save();

		logger.info(
			`[PAYOUT] Pending payout initiated: payoutId=${payoutId} transferCode=${transferCode}`,
		);
		return { success: true, payout };
	} catch (err) {
		logger.error(
			`processPendingPayout: transfer failed for ${payoutId}:`,
			err.message,
		);

		// Only reverse if THIS call made the reserve — not a previous one
		if (thisCallReserved) {
			await ledgerService.reverseReserve(
				userId,
				userType,
				amount,
				`Pending payout failed: ${err.message}`,
			);
		}

		payout.status = "failed";
		payout.failureReason = err.message;
		await payout.save();
		return {
			success: false,
			reason: "transfer_failed",
			error: err.message,
			payout,
		};
	}
};

/**
 * Batch-process all pending payouts for a user.
 */
const processPendingPayoutsForUser = async (userId, userType) => {
	const pendingPayouts = await Payout.find({
		user: userId,
		userType,
		status: "pending",
	}).sort({ createdAt: 1 });

	if (pendingPayouts.length === 0) {
		logger.info(
			`processPendingPayoutsForUser: no pending payouts for ${userType} ${userId}`,
		);
		return { processed: 0, results: [] };
	}

	logger.info(
		`processPendingPayoutsForUser: processing ${pendingPayouts.length} pending payout(s) for ${userType} ${userId}`,
	);

	const results = [];

	for (const payout of pendingPayouts) {
		const result = await processPendingPayout(payout._id);
		results.push({ payoutId: payout._id, ...result });

		if (result.reason === "insufficient_funds") {
			logger.warn(
				`processPendingPayoutsForUser: stopping batch — insufficient funds at payoutId=${payout._id}`,
			);
			break;
		}
	}

	const succeeded = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	logger.info(
		`processPendingPayoutsForUser: done — ${succeeded} succeeded, ${failed} failed for ${userType} ${userId}`,
	);

	return { processed: results.length, succeeded, failed, results };
};
