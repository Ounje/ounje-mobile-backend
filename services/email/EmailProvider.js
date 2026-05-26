/**
 * Abstract Email Provider
 * Defines the contract for all email providers.
 */
class EmailProvider {
	/**
	 * Send an email
	 * @param {string} to - Recipient email
	 * @param {string} subject - Email subject
	 * @param {string} html - HTML content
	 * @returns {Promise<boolean>} - Success status
	 */
	async sendEmail(to, subject, html) {
		throw new Error("Method 'sendEmail' must be implemented.");
	}
}

module.exports = EmailProvider;
