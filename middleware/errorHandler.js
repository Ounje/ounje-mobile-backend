/**
 * Global Error Handler Middleware
 * Captures all errors passing through the middleware chain.
 */
const logger = require("../utilis/logger");

const errorHandler = (err, req, res, next) => {
    // 1. Log the error details
    logger.error(`[Global Error] ${err.message}`);
    if (process.env.NODE_ENV === 'development') {
        logger.debug(err.stack);
    }

    // 2. Default Values
    let statusCode = err.statusCode || 500;
    let message = err.message || "Internal Server Error";
    let errorDetails = err.error || null;

    // 3. Handle Mongoose Bad ObjectId (CastError)
    if (err.name === 'CastError') {
        statusCode = 400;
        message = `Resource not found. Invalid: ${err.path}`;
    }

    // 4. Handle Mongoose Validation Errors
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = Object.values(err.errors).map(val => val.message).join(', ');
    }

    // 5. Handle Mongoose Duplicate Key
    if (err.code === 11000) {
        statusCode = 400;
        message = "Duplicate field value entered";
    }

    // 6. Send JSON Response
    res.status(statusCode).json({
        success: false,
        message,
        error: errorDetails,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
};

module.exports = errorHandler;
