const express = require("express");
const { newsBannerUpload } = require("../config/cloudinary");
const newsController = require("../controllers/newsflashController");

const router = express.Router();

//router.post("/create", newsBannerUpload.single("image"), newsController.create);
router.get("/get", newsController.getAll);
router.get("/:id", newsController.getOne);
// router.put(
// 	"/update/:id",
// 	newsBannerUpload.single("image"),
// 	newsController.update,
// );
// router.delete("/delete/:id", newsController.remove);
module.exports = router;
