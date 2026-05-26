const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const commentSchema = new mongoose.Schema(
	{
		plate: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Plate",
			required: true,
			index: true,
		},
		author: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Customer",
			required: true,
		},
		text: {
			type: String,
			required: true,
			maxlength: 1000,
			trim: true,
		},
		likes: { type: Number, default: 0 },

		// For threaded replies — null means it's a top-level comment
		parentComment: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Comment",
			default: null,
		},
		repliesCount: { type: Number, default: 0 },

		isEdited: { type: Boolean, default: false },
		editedAt: { type: Date, default: null },

		// Soft delete — keep record for reply threading integrity
		isDeleted: { type: Boolean, default: false },
		deletedAt: { type: Date, default: null },
	},
	{ timestamps: true },
);

commentSchema.index({ plate: 1, createdAt: -1 }); // fetch comments for a plate, newest first
commentSchema.index({ parentComment: 1, createdAt: 1 }); // fetch replies for a comment

commentSchema.plugin(toJSON);

module.exports = mongoose.model("Comment", commentSchema);
