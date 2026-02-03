const mongoose = require("mongoose");

const newsflashSchema = new mongoose.Schema(
	{
		header: { type: String }, // this could be name or title
		content: { type: String, required: true },
		imageUrl: String,
	},
	{ timestamps: true },
);

module.exports = mongoose.model("Newsflash", newsflashSchema);
