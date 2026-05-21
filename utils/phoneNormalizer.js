const normalizePhone = (phone) => {
	if (!phone) return phone;
	phone = phone.replace(/[\s\-()]/g, "");
	if (phone.startsWith("+")) phone = phone.slice(1);
	if (phone.startsWith("234")) phone = phone.slice(3);
	if (phone.startsWith("0")) phone = phone.slice(1);
	return `+234${phone}`;
};

module.exports = normalizePhone;
