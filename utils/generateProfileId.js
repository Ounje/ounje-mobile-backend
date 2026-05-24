const Counter = require("../models/Counter");

/**
 * Generates a unique human-readable ID for vendors and riders.
 *
 * Format:
 *   Vendor: OUN-VND-XXXX  (e.g. OUN-VND-0001)
 *   Rider:  OUN-RDR-XXXX  (e.g. OUN-RDR-0001)
 *
 * Uses the same Counter model as orderNumber.js for atomic sequential numbering.
 */

async function generateVendorId() {
	const counter = await Counter.findOneAndUpdate(
		{ name: "vendorId" },
		{ $inc: { value: 1 } },
		{ new: true, upsert: true },
	);
	const sequence = String(counter.value).padStart(4, "0");
	return `OUN-VND-${sequence}`;
}

async function generateRiderId() {
	const counter = await Counter.findOneAndUpdate(
		{ name: "riderId" },
		{ $inc: { value: 1 } },
		{ new: true, upsert: true },
	);
	const sequence = String(counter.value).padStart(4, "0");
	return `OUN-RDR-${sequence}`;
}

module.exports = { generateVendorId, generateRiderId };