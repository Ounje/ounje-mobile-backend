const { Customer, VendorProfile, RiderProfile } = require("../models");
const AppError = require("../utils/AppError");

/**
 * Validates the account status of a user based on their role.
 * @param {string} userId - The ID of the user.
 * @param {string} role - The role of the user (customer, vendor, rider).
 * @throws {AppError} If the user profile is not found or is inactive/deactivated.
 */
const validateUserStatus = async (userId, role) => {
    if (role === "customer") {
        const customer = await Customer.findOne({ user: userId });
        if (!customer) {
            throw new AppError("Customer profile not found", 404);
        }
        if (!customer.isActive) {
            // Reactivate customer if they are inactive
            customer.isActive = true;
            await customer.save();
        }
        return true;
    }

    if (role === "vendor") {
        const vendor = await VendorProfile.findOne({ owner: userId });
        if (!vendor) {
            throw new AppError("Vendor profile not found", 404);
        }
            return true;
    }

    if (role === "rider") {
        const rider = await RiderProfile.findOne({ user: userId });
        if (!rider) {
            throw new AppError("Rider profile not found", 404);
        }
        if (rider.status === "deactivated") {
            throw new AppError(
                "Rider account is not active. Please contact support.",
                403
            );
        }
        return true;
    }

    throw new AppError("Invalid user role", 403);
};

module.exports = { validateUserStatus };
