const Counter = require("../models/Counter");

/**
 * Generates a sequential, zero-padded ID with a prefix.
 * @param {string} type - 'vendor_id' or 'rider_id'
 * @param {string} prefix - 'VND' or 'RDR'
 * @returns {Promise<string>} - e.g., 'VND-0001'
 */
const generateId = async (type, prefix) => {
	const counter = await Counter.findByIdAndUpdate(
		type,
		{ $inc: { seq: 1 } },
		{ new: true, upsert: true },
	);

	const paddedSeq = counter.seq.toString().padStart(4, "0");
	return `${prefix}-${paddedSeq}`;
};

module.exports = {
	generateId,
};
