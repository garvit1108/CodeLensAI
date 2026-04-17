const { analyzeReviewWithOpenAI } = require("../services/openaiService");

async function runAIAnalyzer(code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";

	try {
		const review = await analyzeReviewWithOpenAI(source, language);
		return {
			success: true,
			review,
		};
	} catch {
		return {
			success: false,
			review: null,
		};
	}
}

module.exports = {
	runAIAnalyzer,
};
