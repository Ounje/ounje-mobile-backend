const Announcement = require("../models/Announcement");

// GET all active announcements for frontend banner
exports.getActiveAnnouncements = async (req, res) => {
  try {
    const role = req.user?.role || "all"; // if auth exists
    const now = new Date();

    const announcements = await Announcement.find({
      isActive: true,
      $and: [
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $gt: now } }
          ]
        },
        {
          $or: [
            { targetRoles: "all" },
            { targetRoles: role }
          ]
        }
      ]
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: announcements
    });

  } catch (error) {
    console.error("Error fetching announcements:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch announcements",
      error: error.message
    });
  }
};