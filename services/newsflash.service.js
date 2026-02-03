const NewsFlash = require("../models/newsflash");

const createNewsFlash = async (data, file) => {
	const imageUrl = file ? file.path : null;

	return await NewsFlash.create({
		...data,
		imageUrl,
	});
};

const getAllNewsFlash = async () => {
	return await NewsFlash.find().sort({ createdAt: -1 });
};

const getNewsFlashById = async (id) => {
	return await NewsFlash.findById(id);
};

const updateNewsFlash = async (id, data, file) => {
	if (file) {
		data.imageUrl = file.path;
	}

	return await NewsFlash.findByIdAndUpdate(id, data, {
		new: true,
		runValidators: true,
	});
};

const deleteNewsFlash = async (id) => {
	return await NewsFlash.findByIdAndDelete(id);
};

module.exports = {
	createNewsFlash,
	getAllNewsFlash,
	getNewsFlashById,
	updateNewsFlash,
	deleteNewsFlash,
};
