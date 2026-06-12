const SurgeConfig = require("../models/SurgeConfig");

let _cached = 1.0;
let _cacheAt = 0;
const TTL = 30_000; // 30 seconds

async function getSurgeMultiplier() {
  const now = Date.now();
  if (now - _cacheAt < TTL) return _cached;

  try {
    const config = await SurgeConfig.findOne().lean();
    if (!config) {
      _cached = 1.0;
      _cacheAt = now;
      return 1.0;
    }

    // Manual override takes priority
    if (config.isActive) {
      _cached = Math.min(config.multiplier ?? 1.0, 1.3);
      _cacheAt = now;
      return _cached;
    }

    // Check scheduled slots
    if (config.schedule && config.schedule.length > 0) {
      const date = new Date();
      const day  = date.getDay();
      const hour = date.getHours();
      for (const slot of config.schedule) {
        if (!slot.enabled) continue;
        if (slot.days.includes(day) && hour >= slot.startHour && hour < slot.endHour) {
          _cached = Math.min(slot.multiplier ?? 1.0, 1.3);
          _cacheAt = now;
          return _cached;
        }
      }
    }

    _cached = 1.0;
    _cacheAt = now;
    return 1.0;
  } catch (err) {
    console.error("[Surge] Failed to read surge config:", err.message);
    return 1.0; // fail-safe: never block orders
  }
}

module.exports = { getSurgeMultiplier };
