const mongoose = require("mongoose");

const scheduleSlotSchema = new mongoose.Schema({
  label:      { type: String, default: "" },
  days:       { type: [Number], default: [] }, // 0=Sun, 1=Mon, ..., 6=Sat
  startHour:  { type: Number, min: 0, max: 23, default: 8 },
  endHour:    { type: Number, min: 0, max: 23, default: 10 },
  multiplier: { type: Number, default: 1.2 },
  enabled:    { type: Boolean, default: true },
}, { _id: true });

const logEntrySchema = new mongoose.Schema({
  action:     { type: String }, // 'activated' | 'deactivated' | 'updated'
  multiplier: { type: Number },
  reason:     { type: String },
  by:         { type: String },
  at:         { type: Date, default: Date.now },
}, { _id: false });

const surgeConfigSchema = new mongoose.Schema({
  isActive:    { type: Boolean, default: false },
  multiplier:  { type: Number, default: 1.0 },
  reason:      { type: String, default: "" },
  activatedBy: { type: String, default: "" },
  activatedAt: { type: Date },
  schedule:    { type: [scheduleSlotSchema], default: [] },
  logs:        { type: [logEntrySchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("SurgeConfig", surgeConfigSchema);
