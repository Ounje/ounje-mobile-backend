const fs = require("fs").promises;
const path = require("path");
const NodemailerProvider = require("./NodemailerProvider");

class EmailService {
    constructor(provider) {
        this.provider = provider || new NodemailerProvider();
    }

    async loadTemplate(templateName, replacements) {
        try {
            const templatePath = path.join(__dirname, "../../templates", templateName);
            let html = await fs.readFile(templatePath, "utf-8");

            for (const [key, value] of Object.entries(replacements)) {
                html = html.replace(new RegExp(`{{${key}}}`, "g"), value);
            }
            return html;
        } catch (error) {
            console.error(`Error loading template ${templateName}:`, error);
            throw new Error("Template loading failed");
        }
    }

    async sendWelcomeEmail(email, name) {
        const html = await this.loadTemplate("welcome-email.html", { name });
        return this.provider.sendEmail(email, "Welcome to OunjeFood - Eat Fresh, Spend Less, Order Fast!", html);
    }

    async sendOtpEmail(email, otp, purpose = "verification") {
        const otpDigits = otp.split("");
        const replacements = {
            otp_1: otpDigits[0] || "0",
            otp_2: otpDigits[1] || "0",
            otp_3: otpDigits[2] || "0",
            otp_4: otpDigits[3] || "0",
        };

        const html = await this.loadTemplate("otp.html", replacements);
        const subject = purpose === "login" ? "Your OunjeFood Login Code" : "Verify Your OunjeFood Email";

        return this.provider.sendEmail(email, subject, html);
    }
}

module.exports = new EmailService();
