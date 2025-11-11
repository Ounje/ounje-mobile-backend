const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const foodItemsStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "food-items",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 800, quality: "auto" }],
  },
});

const dishesStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "dishes",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 800, quality: "auto" }],
  },
});

const usersStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "users",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 500, height: 500, crop: "thumb", gravity: "face", quality: "auto" }],
  },
});

const deleteImage = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
  }
};
 
const userUpload = multer({storage: usersStorage });
const dishUpload = multer({ storage: dishesStorage });
const foodItemUpload = multer({ storage: foodItemsStorage });

module.exports = { cloudinary, userUpload, dishUpload, foodItemUpload, deleteImage };
