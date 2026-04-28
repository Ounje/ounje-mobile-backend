const ORDER_STATUS = {
	CONFIRMING: "confirming",
	PACKAGING: "packaging",
	PENDING: "pending",
	RIDING: "riding",
	DELIVERED: "delivered",
	CANCELLED: "cancelled",
	DECLINED: "declined",
};

const ORDER_SUB_STATUS = {
	CONFIRMING: "confirming",
	CONFIRMED: "confirmed",
	PACKAGING: "packaging",
	PACKAGED: "packaged",
	LOOKING_FOR_RIDER: "looking_for_rider",
	READY_FOR_PICKUP: "ready_for_pickup",
	RIDER_ASSIGNED: "rider_assigned",
	PICKED_UP: "picked_up",
	ON_THE_WAY: "on_the_way",
	RIDER_ARRIVED: "rider_arrived",
	DELIVERED: "delivered",
	CANCELLED: "cancelled",
	DECLINED: "declined",
};

const DECLINE_REASONS = {
	VENDOR_OUT_OF_STOCK: "vendor_out_of_stock",
	VENDOR_TOO_BUSY: "vendor_too_busy",
	VENDOR_KITCHEN_CLOSED: "vendor_kitchen_closed",
	VENDOR_DELIVERY_AREA_NOT_COVERED: "vendor_delivery_area_not_covered",
	VENDOR_TECHNICAL_ISSUE: "vendor_technical_issue",
	VENDOR_ITEM_UNAVAILABLE: "vendor_item_unavailable",
	VENDOR_PREP_TIME_TOO_LONG: "vendor_prep_time_too_long",
	VENDOR_OTHER: "vendor_other",
};

const CANCELLATION_REASONS = {
	CUSTOMER_CHANGED_MIND: "customer_changed_mind",
	CUSTOMER_ORDERED_BY_MISTAKE: "customer_ordered_by_mistake",
	CUSTOMER_LONG_WAIT_TIME: "customer_long_wait_time",
	CUSTOMER_FOUND_ALTERNATIVE: "customer_found_alternative",
	CUSTOMER_DELIVERY_ADDRESS_ISSUE: "customer_delivery_address_issue",
	CUSTOMER_PAYMENT_ISSUE: "customer_payment_issue",
	CUSTOMER_OTHER: "customer_other",
	VENDOR_OUT_OF_STOCK: "vendor_out_of_stock",
	VENDOR_TOO_BUSY: "vendor_too_busy",
	VENDOR_CANNOT_FULFILL: "vendor_cannot_fulfill",
	VENDOR_TECHNICAL_ISSUE: "vendor_technical_issue",
	VENDOR_OTHER: "vendor_other",
	RIDER_CANNOT_REACH_VENDOR: "rider_cannot_reach_vendor",
	RIDER_CANNOT_REACH_CUSTOMER: "rider_cannot_reach_customer",
	RIDER_VEHICLE_ISSUE: "rider_vehicle_issue",
	RIDER_OTHER: "rider_other",
	SYSTEM_NO_RIDER_AVAILABLE: "system_no_rider_available",
	SYSTEM_PAYMENT_FAILED: "system_payment_failed",
	SYSTEM_TIMEOUT: "system_timeout",
	SYSTEM_OTHER: "system_other",
};

const CANCELLATION_CATEGORIES = {
	CUSTOMER: "customer",
	VENDOR: "vendor",
	RIDER: "rider",
	SYSTEM: "system",
};

const DECLINE_REASON_LABELS = {
	vendor_out_of_stock: "Items are out of stock",
	vendor_too_busy: "We're too busy right now",
	vendor_kitchen_closed: "Kitchen is closed",
	vendor_delivery_area_not_covered: "We don't deliver to this area",
	vendor_technical_issue: "Technical issue occurred",
	vendor_item_unavailable: "Some items are unavailable",
	vendor_prep_time_too_long: "Preparation time would be too long",
	vendor_other: "Unable to fulfill order",
};

const CANCELLATION_REASON_LABELS = {
	customer_changed_mind: "Changed my mind",
	customer_ordered_by_mistake: "Ordered by mistake",
	customer_long_wait_time: "Wait time is too long",
	customer_found_alternative: "Found a better alternative",
	customer_delivery_address_issue: "Issue with delivery address",
	customer_payment_issue: "Payment issue",
	customer_other: "Other (please specify)",
	vendor_out_of_stock: "Items out of stock",
	vendor_too_busy: "Too busy to fulfill",
	vendor_cannot_fulfill: "Cannot fulfill order",
	vendor_technical_issue: "Technical issue",
	vendor_other: "Other (please specify)",
	rider_cannot_reach_vendor: "Cannot reach restaurant",
	rider_cannot_reach_customer: "Cannot reach customer",
	rider_vehicle_issue: "Vehicle issue",
	rider_other: "Other (please specify)",
	system_no_rider_available: "No rider available",
	system_payment_failed: "Payment failed",
	system_timeout: "Order timed out",
	system_other: "System issue",
};

const AVAILABLE_ZONES = [
	"Ikeja",
	"Lekki",
	"Victoria Island",
	"Surulere",
	"Yaba",
	"Ojota",
	"Maryland",
	"Gbagada",
	"Berger",
	"Ikorodu",
	"Ajah",
	"Sangotedo",
	"Ogba",
	"Agege",
];

const DAYS_OF_WEEK = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];

const getAllDeclineReasons = () => Object.values(DECLINE_REASONS);
const getAllCancellationReasons = () => Object.values(CANCELLATION_REASONS);

const getCancellationReasonsByCategory = (category) => {
	const prefix = category.toLowerCase();
	return Object.values(CANCELLATION_REASONS).filter((reason) =>
		reason.startsWith(prefix),
	);
};

module.exports = {
	ORDER_STATUS,
	ORDER_SUB_STATUS,
	DECLINE_REASONS,
	DECLINE_REASON_LABELS,
	CANCELLATION_REASONS,
	CANCELLATION_CATEGORIES,
	CANCELLATION_REASON_LABELS,
	AVAILABLE_ZONES,
	DAYS_OF_WEEK,
	getAllDeclineReasons,
	getAllCancellationReasons,
	getCancellationReasonsByCategory,
};