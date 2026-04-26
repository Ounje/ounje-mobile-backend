const { Customer, VendorProfile, RiderProfile } = require("../models");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

const requireCustomer = asyncHandler(async (req, res, next) => {
    const customer = await Customer.findOne({ user: req.user.id });
    if (!customer) throw new AppError("Customer profile not found", 404);

    req.customer = customer;
    next();
});

const requireVendor = asyncHandler(async (req, res, next) => {
    const vendor = await VendorProfile.findOne({ owner: req.user.id });
    if (!vendor) throw new AppError("Vendor profile not found", 404);

    req.vendor = vendor;
    next();
});

const requireRider = asyncHandler(async (req, res, next) => {
    const rider = await RiderProfile.findOne({ user: req.user.id });
    if (!rider) throw new AppError("Rider profile not found", 404);

    req.rider = rider;
    next();
});

module.exports = {
    requireCustomer,
    requireVendor,
    requireRider,
};
