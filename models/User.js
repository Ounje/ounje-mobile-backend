const mongoose = require("mongoose");
const options = {discriminatorKey: "role", collection: "users"}

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  location: String,      // free text or geo JSON later
  phone: Number,
  img: String,
}, { timestamps: true,
  ...options
 });


module.exports = mongoose.model("User", userSchema);
