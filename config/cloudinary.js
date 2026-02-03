const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const CloudinaryStorage = require("multer-storage-cloudinary");

cloudinary.config({
	cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET,
});

const foodItemsStorage = new CloudinaryStorage({
	cloudinary,
	params: {
		folder: "food-items",
		allowed_formats: ["jpg", "png", "jpeg", "webp"],
		transformation: [{ width: 800, quality: "auto" }],
	},
});

const comboStorage = new CloudinaryStorage({
	cloudinary,
	params: {
		folder: "combos",
		allowed_formats: ["jpg", "png", "jpeg", "webp"],
		transformation: [{ width: 800, quality: "auto" }],
	},
});

const usersStorage = new CloudinaryStorage({
	cloudinary,
	params: {
		folder: "users",
		allowed_formats: ["jpg", "png", "jpeg", "webp"],
		transformation: [
			{
				width: 500,
				height: 500,
				crop: "thumb",
				gravity: "face",
				quality: "auto",
			},
		],
	},
});

const platesStorage = new CloudinaryStorage({
	cloudinary,
	params: {
		folder: "plates",
		allowed_formats: ["jpg", "png", "jpeg", "webp"],
		transformation: [{ width: 800, quality: "auto" }],
	},
});

const NINStorage = new CloudinaryStorage({
	cloudinary,
	params: {
		folder: "vendor-documents",
		allowed_formats: ["jpg", "png", "jpeg", "webp"],
		transformation: [{ width: 800, quality: "auto" }],
	},
});
const deleteImage = async (publicId) => {
	try {
		await cloudinary.uploader.destroy(publicId);
	} catch (err) {
		console.error("Error deleting image:", err);
	}
};

module.exports = {
	cloudinary,
	NINStorage: multer({ storage: NINStorage }),
	userUpload: multer({ storage: usersStorage }),
	comboUpload: multer({ storage: comboStorage }),
	foodItemUpload: multer({ storage: foodItemsStorage }),
	plateUpload: multer({ storage: platesStorage }),
	deleteImage,
};
