const { analyzeWithOpenAI } = require("../services/openaiService");

async function analyzeCode(req, res) {
	const { code = "" } = req.body || {};

	try {
		const review = await analyzeWithOpenAI(code);

		res.json({
			issues: review.issues,
			suggestions: review.suggestions,
			score: review.score,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Something went wrong" });
	}
}

module.exports = {
	analyzeCode,
};
