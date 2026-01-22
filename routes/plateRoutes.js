const express = require("express");
const {
	buildPlate,
	getAllPlates,
	getSpecificPlate,
	deletePlate,
	fixAllPlates,
} = require("../controllers/plateContoller");
const { roleGuard, authMiddleware } = require("../middleware/auth");
const { plateUpload } = require("../config/cloudinary");
const router = express.Router();

router.post(
	"/build-plate",
	authMiddleware,
	plateUpload.single("file"),
	buildPlate,
);

router.get("/get-plates", getAllPlates);

router.get("/plate/:plateId", getSpecificPlate);

router.delete(
	"/plate/:plateId",
	authMiddleware,
	roleGuard(["customer"]),
	deletePlate,
);

router.get("/fix-data", fixAllPlates);

module.exports = router;
