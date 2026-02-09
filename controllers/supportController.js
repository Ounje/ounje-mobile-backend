const supportWhatsAppRedirect = async (req, res) => {
	try {
		const user = req.user;
		const phone = process.env.SUPPORT_WHATSAPP_NUMBER;

		if (!phone) {
			return res.status(500).json({
				success: false,
				message: "Support WhatsApp number not configured",
			});
		}

		const supportType =
			req.query.type === "deactivated" ? "deactivated" : "delivery";

		let message = `Hello Ounje Market Support,\n\n`;

		switch (user.role) {
			case "vendor":
				message += `I am a vendor.\n`;
				message +=
					supportType === "deactivated"
						? `I would like to reactivate my vendor account.\n`
						: `The rider has not delivered my food.\n`;
				break;

			case "rider":
				message += `I am a rider.\n`;
				message +=
					supportType === "deactivate"
						? `I would like to reactivate my rider account.\n`
						: `I have an issue with a delivery.\n`;
				break;

			default:
				return res.status(403).json({
					success: false,
					message: "Support access not allowed for this role",
				});
		}

		const encodedMessage = encodeURIComponent(message);
		const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;

		return res.status(200).json({
			success: true,
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
