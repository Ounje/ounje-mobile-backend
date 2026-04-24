const calculateCustomerRank = (orderCount) => {
	if (orderCount >= 1000) return "OunjeFood Legend";
	if (orderCount >= 500) return "Food Connoisseur";
	if (orderCount >= 200) return "Flavor Chaser";
	if (orderCount >= 100) return "Taste Authority";
	if (orderCount >= 50) return "Bronze Bite";
	return "Bronze Bite";
};

module.exports = calculateCustomerRank;
