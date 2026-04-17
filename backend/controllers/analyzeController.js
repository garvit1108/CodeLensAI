const {
	analyzeLearningWithOpenAI,
	answerFollowUpQuestion,
} = require("../services/openaiService");
const Analysis = require("../models/Analysis");
const { detectLanguageFromCode } = require("../utils/languageDetector");
const { runRuleEngine } = require("../analyzer/ruleEngine");
const { runAIAnalyzer } = require("../analyzer/aiAnalyzer");
const { normalizePipelineResult } = require("../analyzer/mergeResults");

function buildReviewPayload(review, code, userId) {
	return {
		code,
		issues: review.issues || [],
		suggestions: review.suggestions || [],
		refactoredCode: review.refactoredCode || "",
		score: typeof review.score === "number" ? review.score : 0,
		user: userId,
	};
}

function ensureLearningHints(learningResult) {
	const hints = Array.isArray(learningResult?.hints) ? learningResult.hints.filter(Boolean) : [];

	if (hints.length > 0) {
		return hints;
	}

	return [
		{
			line: 1,
			step1: "Consider edge cases for this function.",
			step2: "What happens if unexpected inputs are passed?",
			step3: "Think about adding validation or handling edge cases.",
		},
	];
}

async function analyzeCode(req, res) {
	const { code = "", mode: requestMode = "review" } = req.body || {};
	const userId = req.user?.id;
	let mode = typeof requestMode === "string" ? requestMode.trim().toLowerCase() : "review";
	if (!mode) mode = "review";
	const selectedMode = mode === "learning" ? "learning" : "review";
	const normalizedCode = typeof code === "string" ? code : "";
	const detectedLanguage = detectLanguageFromCode(normalizedCode);

	if (!userId) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	if (!normalizedCode.trim()) {
		return res.status(400).json({
			mode: selectedMode,
			error: "Code is required",
		});
	}

	try {
		if (selectedMode === "learning") {
			try {
				const learningResult = await analyzeLearningWithOpenAI(normalizedCode, detectedLanguage);
				return res.json({
					mode: "learning",
					language: detectedLanguage,
					hints: ensureLearningHints(learningResult),
					score: typeof learningResult?.score === "number" ? learningResult.score : 0,
				});
			} catch (learningError) {
				console.error("Learning analysis error:", learningError.message || learningError);
				return res.status(500).json({
					mode: "learning",
					language: detectedLanguage,
					hints: ensureLearningHints(null),
					score: 0,
					error: "Learning analysis failed",
				});
			}
		}

		// Pipeline: input -> rules -> AI -> normalize -> response
		let normalizedReview;
		try {
			const ruleStage = runRuleEngine(normalizedCode, detectedLanguage);
			let aiStage = { success: false, review: null };

			if (!ruleStage.syntaxValidation?.hasSyntaxErrors) {
				aiStage = await runAIAnalyzer(normalizedCode, detectedLanguage);
			}

			normalizedReview = normalizePipelineResult({
				code: normalizedCode,
				language: detectedLanguage,
				ruleAnalysis: ruleStage.ruleAnalysis,
				syntaxValidation: ruleStage.syntaxValidation,
				aiStage,
			});
		} catch (pipelineError) {
			console.error("Review analysis error:", pipelineError.message || pipelineError);
			normalizedReview = normalizePipelineResult({
				code: normalizedCode,
				language: detectedLanguage,
				ruleAnalysis: { issues: [] },
				syntaxValidation: { issues: [], suggestions: [], hasSyntaxErrors: false },
				aiStage: { success: false, review: null },
			});
		}

		const analysisData = buildReviewPayload(normalizedReview, normalizedCode, userId);
		await Analysis.create(analysisData);

		return res.json({
			mode: "review",
			language: detectedLanguage,
			degraded: Boolean(normalizedReview.degraded),
			fallback: normalizedReview.fallback || null,
			preValidation: normalizedReview.preValidation || null,
			rulesEnforced: Boolean(normalizedReview.rulesEnforced),
			ruleCheckResults: normalizedReview.ruleCheckResults || {
				rulesApplied: false,
				ruleIssueCount: 0,
				aiEnforced: false,
			},
			...analysisData,
		});

	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Something went wrong" });
	}
}

const followUpQuestion = async (req, res) => {
	try {
		const { code, issues = [], suggestions = [], refactoredCode = "", question } = req.body;

		if (!code || !question) {
			return res.status(400).json({ error: "Code and question are required." });
		}

		const mentorResponse = await answerFollowUpQuestion(code, issues, suggestions, refactoredCode, question);

		return res.json(mentorResponse);
	} catch (error) {
		console.error("Follow-up question error:", error.message || error);
		return res.status(500).json({
			error: "Failed to process follow-up question.",
		});
	}
};

module.exports = {
	analyzeCode,
	followUpQuestion,
};