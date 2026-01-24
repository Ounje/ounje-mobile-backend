const fs = require("fs").promises;
const nodemailer = require("nodemailer");
const path = require("path");
const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASS,
	},
});
const sendWelcomeEmail = async (email, name) => {
	try {
		const templatePath = path.join(
			__dirname,
			"../templates/welcome-email.html",
		);
		let htmlTemplate = await fs.readFile(templatePath, "utf-8");

		htmlTemplate = htmlTemplate.replace("{{name}}", name);

		await transporter.sendMail({
			from: process.env.EMAIL_USER,
			to: email,
			subject: "Welcome to OunjeFood - Eat Fresh, Spend Less, Order Fast!",
			html: htmlTemplate,
		});

		//console.log(`Welcome email sent to ${email}`);
		return true;
	} catch (error) {
		console.error("Error sending welcome email:", error);
		return false;
	}
};

const sendOtpEmail = async (email, otp, purpose = "verification") => {
	try {
		const templatePath = path.join(__dirname, "../templates/otp.html");
		let htmlTemplate = await fs.readFile(templatePath, "utf-8");

		const otpDigits = otp.split("");
		htmlTemplate = htmlTemplate.replace("{{otp_1}}", otpDigits[0] || "0");
		htmlTemplate = htmlTemplate.replace("{{otp_2}}", otpDigits[1] || "0");
		htmlTemplate = htmlTemplate.replace("{{otp_3}}", otpDigits[2] || "0");
		htmlTemplate = htmlTemplate.replace("{{otp_4}}", otpDigits[3] || "0");

		const subject =
			purpose === "login"
				? "Your OunjeFood Login Code"
				: "Verify Your OunjeFood Email";

		await transporter.sendMail({
			from: process.env.EMAIL_USER,
			to: email,
			subject: subject,
			html: htmlTemplate,
		});

		//console.log(`OTP email sent to ${email}`);
		return true;
	} catch (error) {
		console.error("Error sending OTP email:", error);
		throw error;
	}
};

module.exports = {
	sendOtpEmail,
	sendWelcomeEmail,
};
