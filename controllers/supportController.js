const SupportTicket = require("../models/SupportTicket");
const VendorProfile = require("../models/VendorProfile");
const RiderProfile = require("../models/RiderProfile");

const supportWhatsAppRedirect = async (req, res) => {
	try {
		if (!req.user) {
			return res.status(401).json({
				success: false,
				message: "Authentication required",
			});
		}

		const user = req.user;
		const userId = user._id || user.id;
		if (!userId) {
			return res.status(401).json({
				success: false,
				message: "Invalid authentication payload",
			});
		}

		const phone = process.env.SUPPORT_WHATSAPP_NUMBER;
		if (!phone) {
			return res.status(500).json({
				success: false,
				message: "Support WhatsApp number not configured",
			});
		}

		const supportType =
			req.query.type === "deactivated" ? "deactivated" : "delivery";

		let subject;
		let category = "General";
		let messageBody = `Hello Ounje Market Support,\n\n`;

		switch (user.role) {
			case "vendor":
				messageBody += "I am a vendor.\n";
				if (supportType === "deactivated") {
					subject = "Vendor Account Reactivation";
					category = "Account";
					messageBody += "I would like to reactivate my vendor account.\n";
				} else {
					subject = "Delivery Issue (Vendor)";
					category = "Order";
					messageBody += "The rider has not delivered my food.\n";
				}
				break;

			case "rider":
				messageBody += "I am a rider.\n";
				if (supportType === "deactivated") {
					subject = "Rider Account Reactivation";
					category = "Account";
					messageBody += "I would like to reactivate my rider account.\n";
				} else {
					subject = "Delivery Issue (Rider)";
					category = "Order";
					messageBody += "I have an issue with a delivery.\n";
				}
				break;

			default:
				return res.status(403).json({
					success: false,
					message: "Support access not allowed for this role",
				});
		}

		const existingTicket = await SupportTicket.findOne({
			user: userId, // Mongoose will automatically cast string to ObjectId
			category,
			status: { $in: ["Open", "In-Progress", "Pending-Reply"] },
		});

		if (existingTicket) {
			return res.status(409).json({
				success: false,
				message: "You already have an open support ticket for this issue.",
				ticketId: existingTicket._id,
			});
		}

		let relatedVendor = null;
		let relatedRider = null;

		if (user.role === "vendor") {
			const vendor = await VendorProfile.findOne({ owner: userId }).select(
				"_id",
			);

			if (!vendor) {
				return res.status(400).json({
					success: false,
					message: "Vendor profile not found",
				});
			}

			relatedVendor = vendor._id;
		}

		if (user.role === "rider") {
			const rider = await RiderProfile.findOne({ user: userId }).select("_id");

			if (!rider) {
				return res.status(400).json({
					success: false,
					message: "Rider profile not found",
				});
			}

			relatedRider = rider._id;
		}

		const ticket = await SupportTicket.create({
			user: userId,
			subject,
			category,
			relatedVendor,
			relatedRider,
			messages: [
				{
					sender: userId,
					senderModel: "User",
					message: messageBody,
				},
			],
		});

		const encodedMessage = encodeURIComponent(messageBody);
		const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;

		return res.status(200).json({
			success: true,
			ticketId: ticket._id,
			url: whatsappUrl,
		});
	} catch (err) {
		return res.status(500).json({
			success: false,
			message: err.message,
		});
	}
};

module.exports = {
	supportWhatsAppRedirect,
};
