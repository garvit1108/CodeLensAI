function toLine(value, maxLine = 1) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 1;
	return Math.max(1, Math.min(maxLine, Math.round(n)));
}

function clampScore(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(100, Math.round(n)));
}

function sortByConfidence(issues) {
	return [...issues].sort((a, b) => {
		const confA = typeof a?.confidence === "number" ? a.confidence : 0.5;
		const confB = typeof b?.confidence === "number" ? b.confidence : 0.5;
		return confB - confA;
	});
}

function normalizeIssue(item, maxLine, source = "rule") {
	if (!item || typeof item !== "object") return null;

	const line = toLine(item.line, maxLine);
	const message = String(item.issue || item.message || "").trim();
	if (!message) return null;

	const severityRaw = String(item.severity || "warning").toLowerCase();
	const severity = severityRaw === "error" || severityRaw === "suggestion" ? severityRaw : "warning";
	const confidence = typeof item.confidence === "number"
		? item.confidence
		: source === "rule"
			? 0.92
			: severity === "error"
				? 0.8
				: severity === "suggestion"
					? 0.65
					: 0.72;

	return {
		line,
		issue: message,
		message,
		explanation: String(item.explanation || "").trim() || "This finding highlights a concrete improvement opportunity in the current code.",
		codeElement: String(item.codeElement || "").trim(),
		severity,
		type: String(item.type || (severity === "error" ? "correctness" : "quality")).trim().toLowerCase(),
		fixSuggestion: String(item.fixSuggestion || "").trim(),
		fix: item.fix && typeof item.fix === "object"
			? {
				before: String(item.fix.before || "").trim(),
				after: String(item.fix.after || "").trim(),
			}
			: { before: "", after: "" },
		source,
		confidence,
	};
}

function normalizeSuggestion(item, maxLine) {
	if (!item || typeof item !== "object") return null;

	const relatedLine = toLine(item.relatedLine ?? item.line, maxLine);
	const message = String(item.message || "").trim();
	if (!message) return null;

	const typeRaw = String(item.improvementType || "").toLowerCase().trim();
	const improvementType = typeRaw === "performance" || typeRaw === "safety" || typeRaw === "readability"
		? typeRaw
		: "readability";

	return {
		message,
		relatedLine,
		line: relatedLine,
		improvementType,
	};
}

function dedupeIssues(items) {
	const seen = new Set();
	const out = [];
	for (const item of items) {
		const key = `${item.line}|${item.issue}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function dedupeSuggestions(items) {
	const seen = new Set();
	const out = [];
	for (const item of items) {
		const key = `${item.relatedLine}|${item.improvementType}|${item.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function buildFallbackSuggestions(sourceCode) {
	const firstLine = String(sourceCode || "").split(/\r?\n/)[0]?.trim() || "Code entry path";
	return [
		{
			message: `Line 1 (\"${firstLine}\"): Add input validation before processing. This matters because unvalidated input can crash runtime paths. Concrete improvement: validate null/undefined and required fields at function entry.`,
			relatedLine: 1,
			line: 1,
			improvementType: "safety",
		},
		{
			message: `Line 1 (\"${firstLine}\"): Review edge cases for empty input and boundary indexing. This matters because boundary misses cause unstable behavior. Concrete improvement: add guards for empty arrays and out-of-range access.`,
			relatedLine: 1,
			line: 1,
			improvementType: "safety",
		},
		{
			message: `Line 1 (\"${firstLine}\"): Improve naming clarity. This matters because ambiguous names increase maintenance errors. Concrete improvement: rename short/generic identifiers to role-based names.`,
			relatedLine: 1,
			line: 1,
			improvementType: "readability",
		},
	];
}

function ensureUsefulIssues(ruleIssues, sourceCode, maxLine) {
	if (ruleIssues.length > 0) return ruleIssues;
	const sample = String(sourceCode || "").split(/\r?\n/)[0] || "Code submitted for analysis.";
	return [
		{
			line: toLine(1, maxLine),
			issue: "AI analysis is temporarily unavailable; deterministic checks found no critical rule violations.",
			message: "AI analysis is temporarily unavailable; deterministic checks found no critical rule violations.",
			explanation: "You still received a partial analysis with reliable baseline guidance.",
			codeElement: sample,
			severity: "suggestion",
			type: "resilience",
			fixSuggestion: "Continue with deterministic checks and strengthen input validation for critical paths.",
			fix: { before: sample, after: sample },
			source: "rule",
			confidence: 0.9,
		},
	];
}

function computeScore(issues, baseScore = 70) {
	const rulePenalty = issues
		.filter((item) => item.source === "rule" && item.severity === "error")
		.reduce((sum, item) => sum + (item.confidence || 0.9) * 8, 0);

	const aiPenalty = issues
		.filter((item) => item.source === "ai" && item.severity === "error")
		.reduce((sum) => sum + 3, 0);

	return clampScore(baseScore - rulePenalty - aiPenalty);
}

function normalizePipelineResult({
	code,
	language,
	ruleAnalysis,
	syntaxValidation,
	aiStage,
}) {
	const source = typeof code === "string" ? code : "";
	const maxLine = Math.max(1, source.split(/\r?\n/).length);

	const normalizedRuleIssues = (ruleAnalysis?.issues || [])
		.map((item) => normalizeIssue(item, maxLine, "rule"))
		.filter(Boolean);

	const normalizedSyntaxIssues = (syntaxValidation?.issues || [])
		.map((item) => normalizeIssue(item, maxLine, "rule"))
		.filter(Boolean);

	const normalizedAISuggestions = (aiStage?.review?.suggestions || [])
		.map((item) => normalizeSuggestion(item, maxLine))
		.filter(Boolean);

	const normalizedRuleSuggestions = (syntaxValidation?.suggestions || [])
		.map((item) => normalizeSuggestion(item, maxLine))
		.filter(Boolean);

	if (syntaxValidation?.hasSyntaxErrors) {
		const issues = sortByConfidence(dedupeIssues([...normalizedSyntaxIssues, ...normalizedRuleIssues]));
		const suggestions = dedupeSuggestions([...normalizedRuleSuggestions, ...buildFallbackSuggestions(source)]).slice(0, 5);
		return {
			mode: "review",
			language,
			preValidation: "syntax",
			degraded: false,
			fallback: null,
			rulesEnforced: normalizedRuleIssues.length > 0,
			ruleCheckResults: {
				rulesApplied: normalizedRuleIssues.length > 0,
				ruleIssueCount: normalizedRuleIssues.length,
				aiEnforced: false,
			},
			issues,
			suggestions,
			refactoredCode: "",
			score: 0,
		};
	}

	if (!aiStage?.success) {
		const ruleOnlyIssues = ensureUsefulIssues(normalizedRuleIssues, source, maxLine);
		const issues = sortByConfidence(dedupeIssues(ruleOnlyIssues));
		const suggestions = dedupeSuggestions(buildFallbackSuggestions(source)).slice(0, 5);
		return {
			mode: "review",
			language,
			degraded: true,
			fallback: "rules-only",
			rulesEnforced: normalizedRuleIssues.length > 0,
			ruleCheckResults: {
				rulesApplied: normalizedRuleIssues.length > 0,
				ruleIssueCount: normalizedRuleIssues.length,
				aiEnforced: false,
			},
			issues,
			suggestions,
			refactoredCode: source,
			score: computeScore(issues, 70),
		};
	}

	const normalizedAIIssues = (aiStage?.review?.issues || [])
		.map((item) => normalizeIssue(item, maxLine, "ai"))
		.filter(Boolean);

	const issues = sortByConfidence(dedupeIssues([...normalizedAIIssues, ...normalizedRuleIssues]));
	const suggestions = dedupeSuggestions([...normalizedAISuggestions, ...normalizedRuleSuggestions]).slice(0, 5);
	const aiScore = Number(aiStage?.review?.score);

	return {
		mode: "review",
		language,
		degraded: false,
		fallback: null,
		rulesEnforced: normalizedRuleIssues.length > 0,
		ruleCheckResults: {
			rulesApplied: normalizedRuleIssues.length > 0,
			ruleIssueCount: normalizedRuleIssues.length,
			aiEnforced: false,
		},
		issues,
		suggestions,
		refactoredCode: String(aiStage?.review?.refactoredCode || source),
		score: computeScore(issues, Number.isFinite(aiScore) ? aiScore : 70),
	};
}

module.exports = {
	normalizePipelineResult,
};
