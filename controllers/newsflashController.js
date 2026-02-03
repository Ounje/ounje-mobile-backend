const service = require("../services/newsflash.service");

exports.create = async (req, res) => {
	try {
		const news = await service.createNewsFlash(req.body, req.file);
		res.status(201).json(news);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}
};

exports.getAll = async (req, res) => {
	const news = await service.getAllNewsFlash();
	res.json(news);
};

exports.getOne = async (req, res) => {
	const news = await service.getNewsFlashById(req.params.id);
	if (!news) return res.status(404).json({ message: "Not found" });
	res.json(news);
};

exports.update = async (req, res) => {
	const news = await service.updateNewsFlash(req.params.id, req.body, req.file);
	if (!news) return res.status(404).json({ message: "Not found" });
	res.json(news);
};

exports.remove = async (req, res) => {
	const news = await service.deleteNewsFlash(req.params.id);
	if (!news) return res.status(404).json({ message: "Not found" });
	res.json({ message: "Deleted successfully" });
};
