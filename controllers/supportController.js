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

		// Build message as plain text
		let message = `Hello Ounje Support,\n\n`;

		if (user.role === "vendor") {
			message += `I am a vendor.\n`;
			message += `The rider has not delivered my food.\n`;
		} else if (user.role === "rider") {
			message += `I am a rider.\n`;
			message += `I have an issue with a delivery.\n`;
		} else {
			return res.status(403).json({
				success: false,
				message: "Support access not allowed for this role",
			});
		}

		//message += `\nUser ID: ${user.id}`;

		// Encode once
		const encodedMessage = encodeURIComponent(message);

		const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;

		return res.status(200).json({
			success: true,
			url: whatsappUrl,
		});
	} catch (err) {
		return res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

module.exports = {
	supportWhatsAppRedirect,
};
