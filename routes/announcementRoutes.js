// routes/announcement.routes.js
const express = require("express");
const router = express.Router();
const { getActiveAnnouncements } = require("../controllers/announcementController");

router.get("/active", getActiveAnnouncements);

module.exports = router;
