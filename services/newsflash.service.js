const { Newsflash } = require("../models");

const createNewsFlash = async (data, file) => {
	const imageUrl = file ? file.path : null;

	return await Newsflash.create({
		...data,
		imageUrl,
	});
};

const getAllNewsFlash = async () => {
	return await Newsflash.find().sort({ createdAt: -1 });
};

const getNewsFlashById = async (id) => {
	return await Newsflash.findById(id);
};

const updateNewsFlash = async (id, data, file) => {
	if (file) {
		data.imageUrl = file.path;
	}

	return await Newsflash.findByIdAndUpdate(id, data, {
		new: true,
		runValidators: true,
	});
};

const deleteNewsFlash = async (id) => {
	return await Newsflash.findByIdAndDelete(id);
};

module.exports = {
	createNewsFlash,
	getAllNewsFlash,
	getNewsFlashById,
	updateNewsFlash,
	deleteNewsFlash,
};
