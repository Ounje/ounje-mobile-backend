const mongoose = require("mongoose");

const withdrawalOtpSessionSchema = new mongoose.Schema({
	user: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},
	userType: {
		type: String,
		enum: ["VENDOR", "RIDER"],
		required: true,
	},
	phone: {
		type: String,
		required: true,
		trim: true,
	},
	reference: {
		type: String,
		required: true,
		index: true,
	},
	createdAt: {
		type: Date,
		default: Date.now,
		expires: 10 * 60,
	},
});

module.exports = mongoose.model(
	"WithdrawalOtpSession",
	withdrawalOtpSessionSchema,
);
