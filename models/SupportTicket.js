const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Message sub-document
 */
const messageSchema = new Schema(
	{
		sender: {
			type: Schema.Types.ObjectId,
			required: true,
			refPath: "messages.senderModel",
		},
		senderModel: {
			type: String,
			required: true,
			enum: ["User", "Admin"],
		},
		message: {
			type: String,
			required: true,
			trim: true,
		},
	},
	{ timestamps: true },
);

/**
 * Support Ticket
 */
const supportTicketSchema = new Schema(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		subject: {
			type: String,
			required: true,
			trim: true,
		},
		status: {
			type: String,
			enum: ["Open", "In-Progress", "Pending-Reply", "Resolved", "Closed"],
			default: "Open",
		},
		priority: {
			type: String,
			enum: ["Low", "Medium", "High", "Urgent"],
			default: "Medium",
		},
		assignee: {
			type: Schema.Types.ObjectId,
			ref: "Admin",
			default: null,
		},
		category: {
			type: String,
			enum: ["Order", "Payment", "Account", "Technical", "General"],
			required: true,
		},

		relatedVendor: {
			type: Schema.Types.ObjectId,
			ref: "VendorProfile",
			default: null,
		},

		relatedRider: {
			type: Schema.Types.ObjectId,
			ref: "RiderProfile",
			default: null,
		},

		messages: [messageSchema],
	},
	{ timestamps: true },
);

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
