const { DAYS_OF_WEEK } = require("./constants");
const { parseTime: _parseTime } = require("../utils/time");
// ── Vendor schedule check ─────────────────────────────────────────────────────
/**
 * Returns true if the vendor is currently accepting orders based on their
 * configured schedule. Nigeria is WAT (UTC+1), no DST.
 *
 * - InstantMeals / hybridMeals: checks timePeriod day + opening/closing hours
 * - preOrderMeals: checks that now falls within at least one orderingTime window
 *   (stored as a range string e.g. "10:00 AM - 11:00 AM")
 */
const isVendorOpenNow = (vendor) => {
    const storeDetails = vendor.storeDetails?.[0];
    if (!storeDetails) return false;

    const { servicesOffered } = storeDetails;

    // Shift current time to WAT (UTC+1)
    const now = new Date(Date.now() + 60 * 60 * 1000);
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    // ── preOrderMeals ────────────
    if (servicesOffered === "preOrderMeals") {
        const { preorderPeriods } = storeDetails;
        if (!preorderPeriods || preorderPeriods.length === 0) return false;

        return preorderPeriods.some((entry) => {
            if (!entry.orderingTime) return false;

            const open = _parseTime(entry.orderingTime);
            if (open === null) return false;

            // Orders accepted from orderingTime onwards
            return nowMinutes >= open;
        });
    }

    // ── InstantMeals / hybridMeals ────────────────────────────────────────────
    const { timePeriod } = storeDetails;
    if (!timePeriod || timePeriod.length === 0) return false;

    const todayName = DAYS_OF_WEEK[now.getUTCDay()];
    const todayEntry = timePeriod.find(
        (t) => t.day?.toLowerCase() === todayName,
    );
    if (!todayEntry) return false;

    const open = _parseTime(todayEntry.openingHour);
    const close = _parseTime(todayEntry.closingHour);
    if (open === null || close === null) return false;

    // Support overnight schedules e.g. 22:00 → 02:00
    if (close < open) return nowMinutes >= open || nowMinutes < close;
    return nowMinutes >= open && nowMinutes < close;
};

/**
 * Build a human-readable reason why the vendor is currently closed.
 * Called only when _isVendorOpenNow returns false.
 */
const buildClosedReason = (vendor) => {
    const storeDetails = vendor.storeDetails?.[0];
    const { servicesOffered } = storeDetails;

    if (servicesOffered === "preOrderMeals") {
        const { preorderPeriods } = storeDetails;
        if (!preorderPeriods || preorderPeriods.length === 0) {
            return "This vendor has not configured their preorder windows yet.";
        }
        const windows = preorderPeriods
            .map((p) => `${p.period} (opens at ${p.orderingTime})`)
            .join(", ");
        return `Ordering is currently closed. Preorder windows: ${windows}.`;
    }

    // InstantMeals / hybridMeals
    const { timePeriod } = storeDetails;
    if (!timePeriod || timePeriod.length === 0) {
        return "This vendor has not set their operating hours yet.";
    }

    const now = new Date(Date.now() + 60 * 60 * 1000); // WAT
    const todayName = DAYS_OF_WEEK[now.getUTCDay()];
    const todayEntry = timePeriod.find(
        (t) => t.day?.toLowerCase() === todayName,
    );

    if (!todayEntry) {
        const capitalised =
            todayName.charAt(0).toUpperCase() + todayName.slice(1);
        return `This vendor is closed on ${capitalised}s.`;
    }

    return `This vendor is currently closed. Operating hours today: ${todayEntry.openingHour} – ${todayEntry.closingHour}.`;
};

module.exports = { isVendorOpenNow, buildClosedReason };