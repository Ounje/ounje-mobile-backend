const FOOD_ENUMS = {
	CATEGORIES: {
		PASTRIES: "pastries",
		DRINKS: "drinks",
		SWALLOW: "swallow",
		TRADS: "trads",
		SOUPS: "soups",
		RICE: "rice",
		PROTEIN: "protein",
		SIDES: "sides",
		OTHERS: "others",
	},

	SUB_CATEGORIES: {
		MEAT: "meat",
		FISH: "fish",
		CHICKEN: "chicken",
		TURKEY: "turkey",
		GOAT: "goat",

		SALAD: "salad",
		VEGETABLES: "vegetables",
		PLANTAIN: "plantain",
		BEANS: "beans",

		JUICE: "juice",
		SODA: "soda",
		WATER: "water",
		WINE: "wine",
		BEER: "beer",
		SMOOTHIE: "smoothie",

		SWALLOW: "swallow",
		SOUP: "soup",

		JOLLOF: "jollof",
		FRIED: "fried",
		WHITE: "white",
		COCONUT: "coconut",

		CAKE: "cake",
		BREAD: "bread",
		PIE: "pie",
		DONUT: "donut",
		MUFFIN: "muffin",

		OTHERS: "others",
	},
};

const getCategoryValues = () => Object.values(FOOD_ENUMS.CATEGORIES);
const getSubCategoryValues = () => Object.values(FOOD_ENUMS.SUB_CATEGORIES);

module.exports = {
	FOOD_ENUMS,
	getCategoryValues,
	getSubCategoryValues,
};
