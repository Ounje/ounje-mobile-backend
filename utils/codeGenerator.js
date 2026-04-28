function generateCode(length = 5) {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";
	for (let i = 0; i < length; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

function generatePromoCode(length = 5) {
	return `OUN-${generateCode(length)}`;
}

function generateReferralCode(length = 5) {
	return `OUN-RF-${generateCode(length)}`;
}

module.exports = { generatePromoCode, generateReferralCode };
