const mongoose = require("mongoose");

const CronLockSchema = new mongoose.Schema({
  jobName: { type: String, required: true, unique: true },
  lockedAt: { type: Date, required: true, default: Date.now },
});

module.exports = mongoose.model("CronLock", CronLockSchema);
