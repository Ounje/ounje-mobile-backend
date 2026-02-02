// Standardized Order Statuses
const ORDER_STATUS = {
    PENDING: "PENDING",       // Waiting for rider (was previously CONFIRMING in some contexts or pending)
    CONFIRMING: "CONFIRMING", // Waiting for vendor to accept
    PACKAGING: "PACKAGING",   // Vendor accepted, preparing food (covers COOKING)
    RIDING: "RIDING",         // Rider assigned/picked up (covers Rider Enroute)
    DELIVERED: "DELIVERED",   // Completed
    CANCELLED: "CANCELLED",   // Cancelled
};

const ORDER_SUB_STATUS = {
    CONFIRMING: "CONFIRMING",
    CONFIRMED: "CONFIRMED",
    PACKAGING: "PACKAGING",
    PACKAGED: "PACKAGED",
    // Rider flow
    LOOKING_FOR_RIDER: "LOOKING_FOR_RIDER",
    RIDER_ASSIGNED: "RIDER_ASSIGNED",
    PICKED_UP: "PICKED_UP",
    ON_THE_WAY: "ON_THE_WAY",
    DELIVERED: "DELIVERED",
};

module.exports = {
    ORDER_STATUS,
    ORDER_SUB_STATUS
};
