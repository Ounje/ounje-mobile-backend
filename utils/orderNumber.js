const Counter = require("../models/Counter");

async function generateOrderNumber(orderId) {
	// Take last 3 chars of orderId as the random segment
	const randomSegment = orderId.toString().slice(-3).toUpperCase();

	// Increment counter atomically
	const counter = await Counter.findOneAndUpdate(
		{ name: "orderNumber" },
		{ $inc: { value: 1 } },
		{ new: true, upsert: true }, // create if doesn't exist
	);

	const sequence = String(counter.value).padStart(4, "0");

	return `OUN-${randomSegment}-${sequence}`;
}

module.exports = { generateOrderNumber };
