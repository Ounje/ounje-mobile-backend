const Announcement = require("../models/Announcement");
const notificationService = require("./notification.service");
const User = require("../models/User");
const logger = require("../utils/logger");

const createNewsFlash = async (data, file) => {
	const imageUrl = file ? file.path : null;

	const newsflash = await Announcement.create({
		...data,
		imageUrl,
	});

	// Notify all active vendors about the newsflash
	try {
		const vendors = await User.find({
			__t: "Vendor",
			"storeDetails.status": "active", // Check if store is active
		}).select("_id");

		if (vendors.length > 0) {
			logger.info(
				`Sending newsflash notification to ${vendors.length} vendors`,
			);

			const notificationPromises = vendors.map((vendor) =>
				notificationService
					.notifyNewsFlash(vendor._id, newsflash)
					.catch((err) => {
						logger.error(
							`Failed to notify vendor ${vendor._id}: ${err.message}`,
						);
					}),
			);

			await Promise.allSettled(notificationPromises);
			logger.info(`Newsflash notifications sent to all active vendors`);
		} else {
			logger.warn("No active vendors found to notify about newsflash");
		}
	} catch (error) {
		logger.error(`Failed to send newsflash notifications: ${error.message}`);
	}

	return newsflash;
};

const getAllNewsFlash = async () => {
	return await Announcement.find().sort({ createdAt: -1 });
};

const getNewsFlashById = async (id) => {
	return await Announcement.findById(id);
};

const updateNewsFlash = async (id, data, file) => {
	if (file) {
		data.imageUrl = file.path;
	}

	return await Announcement.findByIdAndUpdate(id, data, {
		new: true,
		runValidators: true,
	});
};

const deleteNewsFlash = async (id) => {
	return await Announcement.findByIdAndDelete(id);
};

module.exports = {
	createNewsFlash,
	getAllNewsFlash,
	getNewsFlashById,
	updateNewsFlash,
	deleteNewsFlash,
};
