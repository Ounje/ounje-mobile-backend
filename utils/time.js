/**
 * Parse a time string into total minutes since midnight.
 * Accepts both 24-hour "HH:MM" and 12-hour "H:MM AM/PM" formats.
 *
 *   "09:30"     →  570
 *   "9:30 AM"   →  570
 *   "12:30 AM"  →   30   (midnight + 30 min)
 *   "12:30 PM"  →  750
 *   "1:30 AM"   →   90
 *
 * Returns null if the string is missing or cannot be parsed.
 */
const parseTime = (str) => {
	if (!str || typeof str !== "string") return null;

	const trimmed = str.trim();

	// 12-hour format: "9:30 AM", "12:30 AM", "1:30 PM" etc.
	const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
	if (amPmMatch) {
		let hh = parseInt(amPmMatch[1], 10);
		const mm = parseInt(amPmMatch[2], 10);
		const period = amPmMatch[3].toUpperCase();

		if (isNaN(hh) || isNaN(mm) || hh < 1 || hh > 12 || mm < 0 || mm > 59)
			return null;

		if (period === "AM") {
			if (hh === 12) hh = 0; // 12:xx AM → 00:xx
		} else {
			if (hh !== 12) hh += 12; // 1:xx PM → 13:xx, but 12:xx PM stays 12:xx
		}

		return hh * 60 + mm;
	}

	// 24-hour format: "09:30", "22:00"
	const h24Match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
	if (h24Match) {
		const hh = parseInt(h24Match[1], 10);
		const mm = parseInt(h24Match[2], 10);
		if (isNaN(hh) || isNaN(mm) || hh > 23 || mm > 59) return null;
		return hh * 60 + mm;
	}

	return null;
};

module.exports = { parseTime };