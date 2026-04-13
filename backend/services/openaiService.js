const OpenAI = require("openai");

let client;

function getClient() {
	if (!process.env.OPENAI_API_KEY) {
		return null;
	}

	if (!client) {
		client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	}

	return client;
}

function clampScore(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return 0;
	}

	return Math.max(0, Math.min(100, Math.round(numeric)));
}

function computeScores(issueCount) {
	const penalty = Math.min(60, issueCount * 10);
	const readability = clampScore(85 - penalty);
	const efficiency = clampScore(80 - penalty);
	const overall = clampScore((readability + efficiency) / 2);

	return {
		readability,
		efficiency,
		overall,
	};
}

function buildHeuristicIssue(code) {
	const source = typeof code === "string" ? code : "";
	const lines = source.split(/\r?\n/);

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (/\bconsole\.log\s*\(/.test(line)) {
			return {
				line: i + 1,
				problem: "Debug logging is left in application code.",
				impact: "Unfiltered logs can leak internal data and add noise in production.",
				fix: "Replace this console.log call with structured logger statements behind log levels.",
			};
		}

		if (/\bvar\b/.test(line)) {
			return {
				line: i + 1,
				problem: "var is used for variable declaration.",
				impact: "Function-scoped bindings can cause unintended reassignments and harder-to-track bugs.",
				fix: "Use const by default and let only when reassignment is required.",
			};
		}

		if (/[^=!]==[^=]/.test(line)) {
			return {
				line: i + 1,
				problem: "Loose equality check (==) is used.",
				impact: "Type coercion can make condition checks pass unexpectedly.",
				fix: "Use strict equality (===) to avoid implicit type conversion.",
			};
		}
	}

	return {
		line: 1,
		problem: "No explicit input validation detected near entry points.",
		impact: "Invalid payloads can propagate and cause runtime failures deeper in execution.",
		fix: "Validate required fields and types at the route boundary before business logic runs.",
	};
}

function buildFallbackReview(code) {
	const issue = buildHeuristicIssue(code);
	const score = computeScores(1);

	return {
		issues: [issue],
		suggestions: [issue.fix],
		score,
	};
}

function normalizeIssue(item, maxLine) {
	if (!item || typeof item !== "object") {
		return null;
	}

	const problem = typeof item.problem === "string" ? item.problem.trim() : "";
	const impact = typeof item.impact === "string" ? item.impact.trim() : "";
	const fix = typeof item.fix === "string" ? item.fix.trim() : "";
	if (!problem || !impact || !fix) {
		return null;
	}

	let line = Number(item.line);
	if (!Number.isFinite(line)) {
		line = 1;
	}

	line = Math.max(1, Math.min(maxLine, Math.round(line)));

	return {
		line,
		problem,
		impact,
		fix,
	};
}

function normalizeResponse(data, code) {
	const source = typeof code === "string" ? code : "";
	const maxLine = Math.max(1, source.split(/\r?\n/).length);

	const issues = Array.isArray(data?.issues)
		? data.issues
				.map((item) => normalizeIssue(item, maxLine))
				.filter((item) => item !== null)
		: [];

	if (issues.length === 0) {
		issues.push(buildHeuristicIssue(code));
	}

	const suggestions = Array.isArray(data?.suggestions)
		? data.suggestions.filter((item) => typeof item === "string" && item.trim().length > 0)
		: [];

	if (suggestions.length === 0) {
		suggestions.push(issues[0].fix);
	}

	const readability = clampScore(data?.score?.readability);
	const efficiency = clampScore(data?.score?.efficiency);
	let score;

	if (readability === 0 && efficiency === 0 && !data?.score) {
		score = computeScores(issues.length);
	} else {
		score = {
			readability,
			efficiency,
			overall: clampScore(
				data?.score?.overall ?? (readability + efficiency) / 2
			),
		};
	}

	return {
		issues,
		suggestions,
		score,
	};
}

async function analyzeWithOpenAI(code) {
	const openAIClient = getClient();
	if (!openAIClient) {
		return buildFallbackReview(code);
	}

	const prompt = `Analyze the following code and return ONLY valid JSON in this exact format: {"issues":[{"line":1,"problem":"...","impact":"...","fix":"..."}],"suggestions":["..."],"score":{"readability":0,"efficiency":0,"overall":0}}. Code:\n${code}\nRules: be specific and reference concrete lines or constructs; no generic advice; always return at least 1 issue; line must be a positive integer; scores must be 0-100; do not include markdown, comments, or extra keys.`;

	try {
		const completion = await openAIClient.chat.completions.create({
			model: "gpt-4o-mini",
			temperature: 0.1,
			messages: [
				{
					role: "system",
					content: "You are a strict code reviewer. Output ONLY valid JSON.",
				},
				{ role: "user", content: prompt },
			],
		});

		const content = completion.choices?.[0]?.message?.content || "";
		const parsed = JSON.parse(content);

		return normalizeResponse(parsed, code);
	} catch (error) {
		console.error("OpenAI analyzeWithOpenAI error:", error.message || error);
		return buildFallbackReview(code);
	}
}

module.exports = {
	analyzeWithOpenAI,
};
