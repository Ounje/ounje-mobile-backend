const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now, expires: '30d' }, 
  ip: { type: String },    
});


module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
