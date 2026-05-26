const winston = require("winston");
const path = require("path");

const logLevels = {
	error: 0,
	warn: 1,
	info: 2,
	http: 3,
	debug: 4,
};

const colors = {
	error: "red",
	warn: "yellow",
	info: "green",
	http: "magenta",
	debug: "white",
};

winston.addColors(colors);

const format = winston.format.combine(
	winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
	winston.format.printf(
		(info) => `${info.timestamp} ${info.level}: ${info.message}`,
	),
);

const transports = [
	new winston.transports.Console({
		format: winston.format.combine(
			winston.format.colorize({ all: true }),
			format,
		),
	}),
	new winston.transports.File({
		filename: path.join(__dirname, "../logs/error.log"),
		level: "error",
		format: winston.format.json(),
	}),
	new winston.transports.File({
		filename: path.join(__dirname, "../logs/combined.log"),
		format: winston.format.json(),
	}),
];

const logger = winston.createLogger({
	level: process.env.NODE_ENV === "development" ? "debug" : "info",
	levels: logLevels,
	transports,
});

module.exports = logger;
