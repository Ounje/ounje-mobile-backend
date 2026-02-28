const mongoose = require("mongoose");
const toJSON = require("./plugins/toJSON.plugin");

const categorySchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true },
        slug: { type: String, required: true, unique: true },
        imageUrl: String,
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
);

categorySchema.plugin(toJSON);

module.exports = mongoose.model("Category", categorySchema);
