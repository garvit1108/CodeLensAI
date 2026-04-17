const { Linter } = require("eslint");

const JS_LIKE_LANGUAGES = new Set(["javascript", "typescript"]);

const linter = new Linter();

function getLineText(source, lineNumber) {
	const lines = String(source || "").split(/\r?\n/);
	const line = Number(lineNumber);
	if (!Number.isFinite(line) || line < 1 || line > lines.length) {
		return "";
	}

	return lines[Math.floor(line) - 1].trim();
}

function inferCodeElement(message, source, line) {
	const lineText = getLineText(source, line);
	const rawMessage = typeof message === "string" ? message : "";

	if (/no-undef/i.test(rawMessage)) {
		const match = /'([^']+)'\s+is not defined/i.exec(rawMessage);
		return match?.[1] || "undefined variable";
	}

	if (/semi/i.test(rawMessage)) {
		return lineText || "statement";
	}

	if (/parsing error|syntax error/i.test(rawMessage)) {
		return lineText || "syntax on this line";
	}

	return lineText || "statement";
}

function normalizeRuleIssue(message) {
	if (message.ruleId === "semi") {
		return {
			message: "Missing semicolon.",
			suggestion: "Add a semicolon at the end of this statement.",
			explanation: "Without the semicolon, JavaScript can split or terminate statements in ways that change execution.",
			type: "syntax",
		};
	}

	if (message.ruleId === "no-undef") {
		const varNameMatch = /'([^']+)'\s+is not defined/i.exec(message.message || "");
		const variable = varNameMatch?.[1] || "value";
		return {
			message: `Undefined variable '${variable}'.`,
			suggestion: `Declare or import '${variable}' before using it on this line.`,
			explanation: `If '${variable}' is not defined, this line will throw at runtime and stop execution.`,
			type: "runtime",
		};
	}

	if (message.fatal || /parsing error/i.test(message.message || "")) {
		return {
			message: `Syntax error: ${(message.message || "Invalid syntax").replace(/^Parsing error:\s*/i, "")}`,
			suggestion: "Fix this syntax error before running AI analysis.",
			explanation: "Syntax errors prevent the file from parsing, so the code cannot run or be analyzed reliably.",
			type: "syntax",
		};
	}

	return {
		message: message.message || "Code issue detected.",
		suggestion: "Resolve this issue before proceeding with deeper review.",
		explanation: "This lint finding points to a concrete issue that should be corrected before the code is considered production-ready.",
		type: "quality",
	};
}

function validateSyntaxBeforeAnalysis(code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";
	if (!source.trim() || !JS_LIKE_LANGUAGES.has(language)) {
		return {
			issues: [],
			suggestions: [],
			hasSyntaxErrors: false,
		};
	}

	const messages = linter.verify(
		source,
		{
			languageOptions: {
				ecmaVersion: "latest",
				sourceType: "module",
				globals: {
					console: "readonly",
					require: "readonly",
					module: "readonly",
					exports: "readonly",
					process: "readonly",
					__dirname: "readonly",
					window: "readonly",
					document: "readonly",
				},
			},
			rules: {
				semi: ["error", "always"],
				"no-undef": "error",
			},
		},
		"input.js"
	);

	const issues = [];
	const suggestions = [];
	const seenIssueKeys = new Set();
	const seenSuggestionKeys = new Set();
	let hasSyntaxErrors = false;

	for (const message of messages) {
		const line = Math.max(1, Number.isFinite(message.line) ? message.line : 1);
		const severity = message.severity === 2 ? "error" : "warning";
		const normalized = normalizeRuleIssue(message);
		const issueKey = `${line}|${severity}|${normalized.message}`;
		if (!seenIssueKeys.has(issueKey)) {
			seenIssueKeys.add(issueKey);
			const codeElement = inferCodeElement(normalized.message, source, line);
			issues.push({
				line,
				severity,
				message: normalized.message,
				codeElement,
				type: normalized.type || (severity === "error" ? "syntax" : "quality"),
				explanation: normalized.explanation || normalized.message,
				fixSuggestion: normalized.suggestion,
			});
		}

		const suggestionKey = `${line}|${normalized.suggestion}`;
		if (!seenSuggestionKeys.has(suggestionKey)) {
			seenSuggestionKeys.add(suggestionKey);
			suggestions.push({ line, message: normalized.suggestion });
		}

		if (message.fatal || /parsing error|syntax error/i.test(message.message || "")) {
			hasSyntaxErrors = true;
		}
	}

	return {
		issues,
		suggestions,
		hasSyntaxErrors,
	};
}

module.exports = {
	validateSyntaxBeforeAnalysis,
};
