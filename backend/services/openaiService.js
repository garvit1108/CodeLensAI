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

function inferIssueType(message, severity = "warning") {
	const text = typeof message === "string" ? message.toLowerCase() : "";

	if (/semicolon|parsing error|syntax|bracket|parenthesis|missing\s+\}|missing\s+\)|missing\s+\]/i.test(text)) {
		return "syntax";
	}

	if (/undefined|null|property access|dereference|guard clause/i.test(text)) {
		return "runtime";
	}

	if (/unused variable|unused|dead code/i.test(text)) {
		return "maintainability";
	}

	if (/name|naming|rename|variable\s+name|function\s+name/i.test(text)) {
		return "naming";
	}

	if (/loop|complexity|performance|repeated work|slow|scale/i.test(text)) {
		return "performance";
	}

	if (/edge case|validation|input|guard|empty|null/i.test(text)) {
		return "validation";
	}

	if (severity === "error") {
		return "correctness";
	}

	return "quality";
}

const C_STYLE_LANGUAGES = new Set(["javascript", "typescript", "java", "csharp", "cpp", "go"]);
const GENERIC_SUGGESTION_PATTERNS = [
	/^improve readability\.?$/i,
	/^optimi[sz]e performance\.?$/i,
	/^follow best practices\.?$/i,
	/^clean up code\.?$/i,
	/^refactor this code\.?$/i,
	/^add comments\.?$/i,
];

function escapeRegExp(value) {
	return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLineNumberFromIndex(source, index) {
	const text = typeof source === "string" ? source : "";
	if (!Number.isFinite(index) || index <= 0) {
		return 1;
	}

	let line = 1;
	for (let i = 0; i < index && i < text.length; i += 1) {
		if (text[i] === "\n") {
			line += 1;
		}
	}

	return line;
}

function isGenericSuggestion(message) {
	const text = typeof message === "string" ? message.trim() : "";
	if (!text) return true;

	if (GENERIC_SUGGESTION_PATTERNS.some((pattern) => pattern.test(text))) {
		return true;
	}

	const hasConcreteAnchor = /'[^']+'|\bline\b|\bvariable\b|\bfunction\b|\bparameter\b|\bloop\b/i.test(text);
	const hasVagueOnly = /improve|better|enhance|clean|optimi[sz]e/i.test(text) && !hasConcreteAnchor;
	return hasVagueOnly;
}

function getLineText(source, lineNumber) {
	const lines = String(source || "").split(/\r?\n/);
	const line = Number(lineNumber);
	if (!Number.isFinite(line) || line < 1 || line > lines.length) {
		return "";
	}

	return lines[Math.floor(line) - 1].trim();
}

function sanitizeIssueMessage(rawMessage) {
	if (typeof rawMessage !== "string") {
		return "";
	}

	return rawMessage
		.replace(/\(\s*line\s*:\s*\d+\s*,\s*severity\s*:\s*(error|warning|suggestion)\s*\)/gi, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function inferCodeElement(issueMessage, source, line) {
	const rawMessage = typeof issueMessage === "string" ? issueMessage : "";
	const lineText = getLineText(source, line);
	const quotedName = rawMessage.match(/'([^']+)'/)?.[1] || rawMessage.match(/"([^"]+)"/)?.[1] || "";

	if (quotedName) {
		return quotedName;
	}

	if (/console\.log/i.test(lineText) || /console\.log/i.test(rawMessage)) {
		return "console.log";
	}

	const functionMatch = lineText.match(/\bfunction\s+([A-Za-z_$][\w$]*)/) || lineText.match(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/);
	if (functionMatch?.[1]) {
		return functionMatch[1];
	}

	const declarationMatch = lineText.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
	if (declarationMatch?.[1]) {
		return declarationMatch[1];
	}

	const propertyMatch = lineText.match(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/);
	if (propertyMatch?.[2]) {
		return `${propertyMatch[1]}.${propertyMatch[2]}`;
	}

	if (/\breturn\b/i.test(lineText)) {
		return "return statement";
	}

	if (/\bif\s*\(/i.test(lineText)) {
		return "conditional expression";
	}

	if (/\bfor\s*\(/i.test(lineText) || /\bwhile\s*\(/i.test(lineText)) {
		return "loop condition";
	}

	return lineText || "this line";
}

function buildSpecificSuggestionFromIssue(issue, source) {
	const line = Math.max(1, Number(issue?.line) || 1);
	const lineText = getLineText(source, line);
	const rawMessage = typeof issue?.message === "string" ? issue.message : "";
	const quotedName = rawMessage.match(/'([^']+)'/)?.[1] || rawMessage.match(/"([^"]+)"/)?.[1] || "";

	if (/null|undefined/i.test(rawMessage)) {
		if (quotedName) {
			return `Add a guard before the ${quotedName} access on line ${line}: ${lineText || "check the value before dereferencing it"}.`;
		}

		return `Add a guard clause on line ${line} before this access: ${lineText || "check the value before dereferencing it"}.`;
	}

	if (/semicolon/i.test(rawMessage)) {
		return lineText
			? `Add a semicolon to the end of line ${line}: ${lineText}.`
			: `Add a semicolon at line ${line} to complete the statement.`;
	}

	if (/unused variable/i.test(rawMessage)) {
		return quotedName
			? `Remove the unused variable '${quotedName}' on line ${line}, or use it inside: ${lineText || "the surrounding logic"}.`
			: `Remove the unused value on line ${line} or wire it into the code on that line.`;
	}

	if (/vague|name/i.test(rawMessage)) {
		return quotedName
			? `Rename '${quotedName}' on line ${line} to match its exact role in: ${lineText || "this statement"}.`
			: `Rename the value on line ${line} so the identifier matches the logic it is implementing.`;
	}

	if (/loop|complexity/i.test(rawMessage)) {
		return lineText
			? `Refactor the repeated work on line ${line} in "${lineText}" by moving the lookup outside the loop or caching the result.`
			: `Refactor the loop on line ${line} to avoid repeated work and lower the time complexity.`;
	}

	if (/division/i.test(rawMessage)) {
		return lineText
			? `Guard the denominator before line ${line}: ${lineText}.`
			: `Guard the denominator on line ${line} before dividing.`;
	}

	if (lineText) {
		return `Update line ${line}: ${lineText}.`;
	}

	return `Update the logic on line ${line} to fix the issue reported there.`;
}

function inferImprovementType(message = "") {
	const text = String(message || "").toLowerCase();

	if (/loop|complexity|performance|map|set|cache|memo|nested|repeated|scan|traversal/.test(text)) {
		return "performance";
	}

	if (/null|undefined|guard|validation|edge case|bounds|catch|error|strict equality|division|runtime|safety/.test(text)) {
		return "safety";
	}

	return "readability";
}

function buildWhyReason(improvementType) {
	if (improvementType === "performance") {
		return "it reduces repeated work and helps the code scale with larger inputs";
	}

	if (improvementType === "safety") {
		return "it prevents runtime failures and hard-to-debug edge-case behavior";
	}

	return "it makes intent clearer and lowers maintenance mistakes during future edits";
}

function buildConcreteImprovement(source, line, improvementType, message) {
	const lineText = getLineText(source, line).trim();
	const quotedName = String(message || "").match(/'([^']+)'/)?.[1] || String(message || "").match(/"([^"]+)"/)?.[1] || "";

	if (improvementType === "performance") {
		if (/nested|loop|scan|traversal|find|filter|includes/i.test(message)) {
			return "replace repeated lookups inside loops with a precomputed Map/Set or move invariant work outside the loop";
		}
		return "remove repeated passes by combining traversals or caching computed values";
	}

	if (improvementType === "safety") {
		if (/null|undefined|guard|validation/i.test(message) && quotedName) {
			return `add an explicit guard for '${quotedName}' before dereferencing or processing it`;
		}
		if (/division/i.test(message)) {
			return "add a denominator zero-check before division";
		}
		return "add explicit input validation and guard clauses before risky operations";
	}

	if (quotedName) {
		return `rename '${quotedName}' to reflect its actual role in this statement`;
	}

	if (lineText) {
		return "rename ambiguous identifiers and split dense logic into a small helper with a clear name";
	}

	return "rename unclear identifiers and simplify this block into smaller, purposeful steps";
}

function normalizeSuggestionShape(item, source, maxLine) {
	if (!item || typeof item !== "object") {
		return null;
	}

	const rawMessage = typeof item.message === "string" ? item.message.trim() : "";
	if (!rawMessage || isGenericSuggestion(rawMessage)) {
		return null;
	}

	let relatedLine = Number(item.relatedLine ?? item.line);
	if (!Number.isFinite(relatedLine)) {
		relatedLine = 1;
	}
	relatedLine = Math.max(1, Math.min(maxLine, Math.round(relatedLine)));

	const improvementTypeRaw = typeof item.improvementType === "string" ? item.improvementType.trim().toLowerCase() : "";
	const improvementType = improvementTypeRaw === "performance" || improvementTypeRaw === "safety" || improvementTypeRaw === "readability"
		? improvementTypeRaw
		: inferImprovementType(rawMessage);

	const alreadyStructured = /This matters because/i.test(rawMessage) && /Concrete improvement:/i.test(rawMessage);
	if (alreadyStructured) {
		return {
			message: rawMessage,
			relatedLine,
			line: relatedLine,
			improvementType,
		};
	}

	const codeRef = getLineText(source, relatedLine).trim();
	const whyReason = buildWhyReason(improvementType);
	const concreteImprovement = buildConcreteImprovement(source, relatedLine, improvementType, rawMessage);

	const message = codeRef
		? `Line ${relatedLine} (\"${codeRef}\"): ${rawMessage}. This matters because ${whyReason}. Concrete improvement: ${concreteImprovement}.`
		: `Line ${relatedLine}: ${rawMessage}. This matters because ${whyReason}. Concrete improvement: ${concreteImprovement}.`;

	return {
		message,
		relatedLine,
		line: relatedLine,
		improvementType,
	};
}

function buildFixSuggestionFromIssue(issue, source) {
	const existingSuggestion = typeof issue?.fixSuggestion === "string" ? issue.fixSuggestion.trim() : "";
	if (existingSuggestion) {
		return existingSuggestion;
	}

	return buildSpecificSuggestionFromIssue(issue, source);
}

function extractContextLines(source, lineNumber, contextRadius = 2) {
	const lines = String(source || "").split(/\r?\n/);
	const lineIdx = Math.max(0, Number(lineNumber) - 1);
	const startIdx = Math.max(0, lineIdx - contextRadius);
	const endIdx = Math.min(lines.length, lineIdx + contextRadius + 1);
	
	return {
		before: lines.slice(startIdx, lineIdx).join("\n"),
		target: lines[lineIdx] || "",
		after: lines.slice(lineIdx + 1, endIdx).join("\n"),
		full: lines.slice(startIdx, endIdx).join("\n"),
	};
}

function generateCodeFix(issue, source) {
	const line = Math.max(1, Number(issue?.line) || 1);
	const message = typeof issue?.message === "string" ? issue.message.toLowerCase() : "";
	const context = extractContextLines(source, line, 2);
	const { target } = context;

	// null/undefined guard
	if (/null|undefined|not defined|guard|dereference/.test(message)) {
		const varMatch = target.match(/\b([a-zA-Z_$][\w$]*)\b/);
		const varName = varMatch?.[1] || "value";
		
		if (target.includes("?")) {
			return { before: target, after: target }; // Already safe
		}
		
		if (target.match(/return\s+/)) {
			return {
				before: target,
				after: `if (${varName} == null) return null;\n\t${target}`,
			};
		}
		
		return {
			before: target,
			after: `if (${varName} == null) throw new Error("${varName} cannot be null");\n\t${target}`,
		};
	}

	// semicolon missing
	if (/semicolon/.test(message)) {
		if (target.endsWith(";")) {
			return { before: target, after: target };
		}
		return {
			before: target,
			after: `${target};`,
		};
	}

	// unused variable
	if (/unused|dead code/.test(message)) {
		const varMatch = target.match(/\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\b/);
		if (varMatch?.[1]) {
			return {
				before: target,
				after: "// Variable removed - was unused",
			};
		}
		return { before: target, after: target };
	}

	// vague/bad naming
	if (/vague|name|naming|rename/.test(message)) {
		const shortMatch = target.match(/\b([a-z])\b/);
		if (shortMatch?.[1]) {
			const short = shortMatch[1];
			const suggest = short === "i" ? "index" : short === "j" ? "jIndex" : `${short}Value`;
			return {
				before: target,
				after: target.replace(new RegExp(`\\b${short}\\b`, "g"), suggest),
			};
		}
		return { before: target, after: target };
	}

	// division by zero
	if (/division|divide|zero|denominator/.test(message)) {
		const opMatch = target.match(/\/\s*([a-zA-Z_$][\w$]*|\d+)/);
		if (opMatch?.[1]) {
			const denom = opMatch[1];
			return {
				before: target,
				after: `if (${denom} === 0) throw new Error("Division by zero");\n\t${target}`,
			};
		}
		return {
			before: target,
			after: `// Guard against division by zero\n\t${target}`,
		};
	}

	// assignment in conditional
	if (/assignment.*conditional|condition.*assignment/.test(message)) {
		const assignMatch = target.match(/if\s*\(([^)]*=[^=][^)]*)\)/);
		if (assignMatch?.[1]) {
			const condition = assignMatch[1];
			const assignPart = condition.split("=")[0].trim();
			const comparePart = condition.split("=").slice(1).join("=").trim();
			return {
				before: target,
				after: target.replace(
					/if\s*\(([^)]*=[^=][^)]*)\)/,
					`${assignPart} = ${comparePart};\n\tif (${assignPart})`
				),
			};
		}
		return { before: target, after: target };
	}

	// console.log in production
	if (/console\.log|debug/.test(message)) {
		if (target.includes("console.log")) {
			return {
				before: target,
				after: "// Removed console.log from production code",
			};
		}
		return { before: target, after: target };
	}

	// Generic/performance improvements
	return {
		before: target,
		after: target, // Will use fallback message
	};
}

function buildIssueExplanation(message, source, line, severity = "warning") {
	const text = typeof message === "string" ? message.trim() : "";
	const lineText = getLineText(source, line);
	const symbol = text.match(/'([^']+)'/)?.[1] || text.match(/"([^"]+)"/)?.[1] || "";

	if (!text) {
		return "This issue can cause unexpected behavior or make the code harder to maintain as the codebase grows.";
	}

	if (/semicolon/i.test(text)) {
		return "Missing semicolons can trigger JavaScript automatic semicolon insertion in surprising ways, causing statements to execute differently than intended.";
	}

	if (/null|undefined/i.test(text)) {
		return symbol
			? `If '${symbol}' is null or undefined at runtime, property or method access will throw and break this execution path.`
			: "If this value is null or undefined at runtime, property access can throw and fail the request.";
	}

	if (/unused variable/i.test(text)) {
		return symbol
			? `Unused variable '${symbol}' increases cognitive load and often indicates incomplete or dead logic that can hide real defects.`
			: "Unused variables make the code harder to reason about and can hide unfinished logic.";
	}

	if (/vague|name/i.test(text)) {
		return symbol
			? `Vague name '${symbol}' hides intent, so future changes are more likely to introduce mistakes in this logic.`
			: "Non-descriptive names make intent unclear and increase the chance of incorrect edits.";
	}

	if (/loop|complexity|repeated work/i.test(text)) {
		return "This pattern can scale poorly on large inputs and lead to noticeable latency or timeouts in production.";
	}

	if (/division/i.test(text)) {
		return "Without a zero check, division can produce Infinity/NaN and silently corrupt downstream calculations.";
	}

	if (/bracket|parenthesis|syntax/i.test(text)) {
		return "Syntax mismatches can stop parsing/execution entirely, preventing the application from running this code path.";
	}

	if (/assignment inside a conditional/i.test(text)) {
		return "Assignment in a condition can mutate state unexpectedly and make branch behavior diverge from what the code appears to test.";
	}

	if (/console\.log/i.test(text)) {
		return "Leaving debug logs in production can leak sensitive runtime data and add noisy output that obscures real operational issues.";
	}

	if (/catch\s*block|empty catch/i.test(text)) {
		return "Swallowing errors removes critical failure signals, making incidents much harder to debug and recover from.";
	}

	if (lineText) {
		return `This can break or mislead behavior around line ${line}: ${lineText}.`;
	}

	if (severity === "error") {
		return "This can trigger runtime failures or incorrect output in production.";
	}

	return "This can reduce reliability or readability and make future maintenance more error-prone.";
}

function collectHeuristicFindings(code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";
	const lines = source.split(/\r?\n/);
	const issues = [];
	const suggestions = [];
	const seenIssues = new Set();
	const seenSuggestions = new Set();

	function addIssue(line, message, severity = "warning", explanation = "") {
		const safeLine = Math.max(1, Number.isFinite(Number(line)) ? Number(line) : 1);
		const normalizedSeverity = severity === "error" ? "error" : "warning";
		const key = `${safeLine}|${normalizedSeverity}|${message}`;
		if (seenIssues.has(key)) return;
		seenIssues.add(key);
		const codeElement = inferCodeElement(message, source, safeLine);
		const builtExplanation =
			typeof explanation === "string" && explanation.trim()
				? explanation.trim()
				: buildIssueExplanation(message, source, safeLine, normalizedSeverity);
		const type = inferIssueType(message, normalizedSeverity);
		
		// Generate real before/after fix
		const fix = generateCodeFix({ line: safeLine, message }, source);
		
		issues.push({
			line: safeLine,
			issue: message,
			explanation: builtExplanation,
			fix: {
				before: fix.before,
				after: fix.after,
			},
			source: "ai",
			confidence: normalizedSeverity === "error" ? 0.8 : 0.72,
		});
	}

	function addSuggestion(line, message) {
		const safeLine = Math.max(1, Number.isFinite(Number(line)) ? Number(line) : 1);
		if (isGenericSuggestion(message)) return;
		const normalized = normalizeSuggestionShape({ message, relatedLine: safeLine }, source, Math.max(1, lines.length));
		if (!normalized) return;
		const key = `${normalized.relatedLine}|${normalized.improvementType}|${normalized.message}`;
		if (seenSuggestions.has(key)) return;
		seenSuggestions.add(key);
		suggestions.push(normalized);
	}

	const bracketStack = [];
	const bracketOpenToClose = { "(": ")", "[": "]", "{": "}" };
	const closingBrackets = new Set([")", "]", "}"]);

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		for (let i = 0; i < line.length; i += 1) {
			const ch = line[i];
			if (bracketOpenToClose[ch]) {
				bracketStack.push({ ch, line: lineIndex + 1 });
			} else if (closingBrackets.has(ch)) {
				const last = bracketStack.pop();
				if (!last || bracketOpenToClose[last.ch] !== ch) {
					addIssue(lineIndex + 1, "Mismatched bracket/parenthesis detected. Check opening and closing pairs.", "error");
					addSuggestion(lineIndex + 1, "Balance brackets and parentheses before running the code to avoid parser/runtime failures.");
					break;
				}
			}
		}
	}

	if (bracketStack.length > 0) {
		const unclosed = bracketStack[bracketStack.length - 1];
		addIssue(unclosed.line, "Unclosed bracket/parenthesis detected.", "error");
		addSuggestion(unclosed.line, "Close every opened bracket and parenthesis to keep syntax valid.");
	}

	const cStyle = C_STYLE_LANGUAGES.has(language);
	if (cStyle) {
		for (let i = 0; i < lines.length; i += 1) {
			const trimmed = lines[i].trim();
			if (!trimmed || /^\/\//.test(trimmed) || /^\*/.test(trimmed) || /^#/.test(trimmed)) continue;
			const looksLikeStatement = /[A-Za-z0-9_\]\)'"]$/.test(trimmed);
			const endsWithSafeToken = /[;{}:,]$/.test(trimmed);
			const controlStart = /^(if|for|while|switch|try|catch|else|do|function|class|interface|type|namespace|import|export)\b/.test(trimmed);
			if (looksLikeStatement && !endsWithSafeToken && !controlStart) {
				addIssue(i + 1, "Possible missing semicolon at end of statement.", "warning");
				addSuggestion(i + 1, "Add a semicolon at the end of this statement to avoid JavaScript ASI edge cases.");
			}
		}
	}

	const declarationRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
	const ignoredShortNames = new Set(["i", "j", "k"]);
	let declarationMatch;
	while ((declarationMatch = declarationRegex.exec(source)) !== null) {
		const name = declarationMatch[1];
		const line = getLineNumberFromIndex(source, declarationMatch.index);

		const usageRegex = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
		const usageCount = (source.match(usageRegex) || []).length;
		if (usageCount <= 1) {
			addIssue(line, `Variable '${name}' is declared but never used.`, "warning");
			addSuggestion(line, `Remove unused variable '${name}' or use it in the intended logic path.`);
		}

		const nonDescriptiveName = /^[a-zA-Z]$/.test(name) || /^(data|temp|tmp|value|val|obj|arr|res|ret|foo|bar)$/i.test(name);
		if (nonDescriptiveName && !ignoredShortNames.has(name)) {
			const suggestedName = /^[a-zA-Z]$/.test(name) ? `${name}Value` : `${name}Result`;
			addIssue(line, `Variable name '${name}' is vague and reduces readability.`, "warning");
			addSuggestion(line, `Rename variable '${name}' to a descriptive name such as '${suggestedName}' based on its actual role.`);
		}
	}

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (/\b(if|while)\s*\([^)]*=[^=][^)]*\)/.test(line)) {
			addIssue(i + 1, "Assignment inside a conditional expression may be unintended.", "error");
			addSuggestion(i + 1, "Use a comparison operator in the condition (e.g., ===) or move assignment outside the condition.");
			break;
		}

		if (/\bconsole\.log\s*\(/.test(line)) {
			addIssue(i + 1, "Debug logging found. Remove console.log from production paths.", "warning");
			addSuggestion(i + 1, "Replace console logging with structured logging or remove it for production builds.");
		}

		if (/\bvar\b/.test(line)) {
			addIssue(i + 1, "Use let/const instead of var to prevent scope-related bugs.", "warning");
			addSuggestion(i + 1, "Replace var with const for immutable values and let for mutable values.");
		}

		if (/[^=!]==[^=]/.test(line)) {
			addIssue(i + 1, "Loose equality (==) can cause coercion bugs.", "warning");
			addSuggestion(i + 1, "Use strict equality (===) to avoid implicit type conversion.");
		}
	}

	const loopMatches = source.match(/\b(for|while|do)\b/g) || [];
	if (loopMatches.length >= 2) {
		addIssue(1, "Multiple loops detected; review algorithmic complexity and scalability.", "warning");
		addSuggestion(1, "Consider reducing nested iteration (e.g., map lookups, early exits, memoization) to improve performance.");
	}

	const nestedLoopRegex = /\b(for|while)\b[\s\S]{0,220}\b(for|while)\b/g;
	let nestedLoopMatch;
	while ((nestedLoopMatch = nestedLoopRegex.exec(source)) !== null) {
		const line = getLineNumberFromIndex(source, nestedLoopMatch.index);
		addIssue(line, "Potential nested loop detected, which can degrade performance to O(n^2).", "warning");
		addSuggestion(line, "Replace inner-loop lookups with a precomputed Map/Set to reduce repeated scanning.");
	}

	for (let i = 0; i < lines.length; i += 1) {
		if (/\b(for|while)\b/.test(lines[i]) && /\.(find|filter|map|includes)\s*\(/.test(lines[i])) {
			addIssue(i + 1, "Array traversal inside a loop can cause avoidable repeated work.", "warning");
			addSuggestion(i + 1, "Move repeated lookups outside the loop or build an index once before iterating.");
		}
	}

	if (/\.map\([^)]*\)\.filter\(|\.filter\([^)]*\)\.map\(/.test(source)) {
		addSuggestion(1, "Combine chained array traversals when possible to reduce repeated passes over large collections.");
	}

	const functionMatch = source.match(/function\s+\w*\s*\(([^)]*)\)/);
	if (functionMatch) {
		const params = functionMatch[1]
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean);
		for (const param of params) {
			const hasGuard = new RegExp(`\\bif\\s*\\(\\s*!?\\s*${param}\\b`).test(source);
			const propertyAccess = new RegExp(`\\b${param}\\s*\\.`).test(source);
			if (propertyAccess && !hasGuard) {
				const fnLine = getLineNumberFromIndex(source, functionMatch.index);
				addIssue(fnLine, `Potential null/undefined access on parameter '${param}'.`, "error");
				addSuggestion(fnLine, `Add a guard clause for '${param}' (for example: if (!${param}) return ...) before property access.`);
			}
		}
	}

	const divisionRegex = /\/\s*([A-Za-z_$][\w$]*)/g;
	let divisionMatch;
	while ((divisionMatch = divisionRegex.exec(source)) !== null) {
		const denominator = divisionMatch[1];
		const hasZeroCheck = new RegExp(`\\b${escapeRegExp(denominator)}\\s*(===|==|<=)\\s*0|0\\s*(===|==|>=)\\s*${escapeRegExp(denominator)}`).test(source);
		if (!hasZeroCheck) {
			const line = getLineNumberFromIndex(source, divisionMatch.index);
			addIssue(line, `Division by '${denominator}' has no explicit zero check.`, "warning");
			addSuggestion(line, `Validate '${denominator}' is non-zero before division to avoid runtime edge-case bugs.`);
		}
	}

	if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(source)) {
		addIssue(1, "Empty catch block hides runtime failures.", "warning");
		addSuggestion(1, "Handle caught errors explicitly (log context, recover, or rethrow) instead of swallowing them.");
	}

	return { issues, suggestions };
}

function ensureMinimumSuggestions(suggestions, issues, source = "") {
	const targetCount = 3;
	const maxCount = 5;
	const lineCount = Math.max(1, String(source || "").split(/\r?\n/).length);
	const ensured = [...suggestions]
		.map((s) => normalizeSuggestionShape(s, source, lineCount))
		.filter((s) => s !== null);
	const seen = new Set(ensured.map((s) => `${s.relatedLine}|${s.improvementType}|${s.message}`));

	function add(line, message, improvementType = "readability") {
		const normalized = normalizeSuggestionShape({ message, relatedLine: line, improvementType }, source, lineCount);
		if (!normalized) return;
		const key = `${normalized.relatedLine}|${normalized.improvementType}|${normalized.message}`;
		if (seen.has(key)) return;
		seen.add(key);
		ensured.push(normalized);
	}

	for (const issue of issues) {
		if (ensured.length >= targetCount) break;
		const issueMessage = buildSpecificSuggestionFromIssue(issue, source);
		add(issue.line, issueMessage, inferImprovementType(issue?.issue || issue?.message || issueMessage));
	}

	const firstLine = getLineText(source, 1);
	const fallbackCandidates = [
		{
			line: 1,
			message: firstLine
				? `Apply an early return before running this path: ${firstLine}.`
				: "Apply an early return at the entry point to simplify control flow.",
		},
		{
			line: 1,
			message: firstLine
				? `Rename ambiguous identifiers used in: ${firstLine}.`
				: "Rename ambiguous identifiers to reflect business meaning.",
		},
		{
			line: 1,
			message: firstLine
				? `Split this logic into a small helper to improve readability: ${firstLine}.`
				: "Split dense logic into a helper function with a descriptive name.",
		},
		{
			line: 1,
			message: firstLine
				? `Replace repeated branching in this statement with a clearer guard pattern: ${firstLine}.`
				: "Replace repeated branching with a clearer guard clause pattern.",
		},
	];

	let fallbackIndex = 0;
	while (ensured.length < targetCount && fallbackIndex < fallbackCandidates.length) {
		const candidate = fallbackCandidates[fallbackIndex];
		add(candidate.line, candidate.message, inferImprovementType(candidate.message));
		fallbackIndex += 1;
	}

	let safetyCounter = 0;
	while (ensured.length < targetCount && safetyCounter < 10) {
		safetyCounter += 1;
		add(1, `Refine line 1 with a clearer identifier name and a smaller control-flow block (pass ${safetyCounter}).`, "readability");
	}

	const uniqueTop = ensured
		.filter((item, index, arr) => arr.findIndex((s) => `${s.relatedLine}|${s.improvementType}|${s.message}` === `${item.relatedLine}|${item.improvementType}|${item.message}`) === index)
		.slice(0, maxCount);

	return uniqueTop;
}

function computeQualityScore(issues, suggestions) {
	let score = 100;
	for (const issue of issues) {
		score -= issue.severity === "error" ? 18 : 10;
		if (/bracket|parenthesis|syntax|null|undefined/i.test(issue.message)) {
			score -= 6;
		}
	}

	if (suggestions.length < 3) {
		score -= 8;
	}

	return clampScore(score);
}

function buildFallbackRefactoredCode(code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";
	if (!source.trim()) {
		return "";
	}

	let refactored = source
		.replace(/\bvar\b/g, "let")
		.replace(/([^=!])==([^=])/g, "$1===$2")
		.replace(/^\s*console\.log\(.*\);?\s*$/gm, "");

	// Normalize formatting for readability.
	refactored = refactored
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n");

	const jsLike = C_STYLE_LANGUAGES.has(language);
	if (jsLike) {
		const loopTargets = new Set();
		const loopRegex = /for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*([A-Za-z_$][\w$]*)\.length\s*;\s*i\+\+\s*\)/g;
		let match;
		while ((match = loopRegex.exec(refactored)) !== null) {
			loopTargets.add(match[1]);
		}

		refactored = refactored.replace(loopRegex, "for (let index = 0; index < $1.length; index += 1)");

		for (const target of loopTargets) {
			const itemAccessRegex = new RegExp(`\\b${escapeRegExp(target)}\\s*\\[\\s*i\\s*\\]`, "g");
			refactored = refactored.replace(itemAccessRegex, `${target}[index]`);
		}

		refactored = refactored.replace(/if\s*\(([^)]+)\)\s*return\s*([^;]+);/g, "if ($1) {\n\treturn $2;\n}");
	}

	if (!refactored.trim()) {
		refactored = source;
	}

	return refactored;
}

function normalizeComparableCode(source) {
	return String(source || "")
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+$/gm, "")
		.trim();
}

function ensureAlwaysRefactoredCode(source, candidate, language = "plaintext") {
	const original = typeof source === "string" ? source : "";
	const modelCandidate = typeof candidate === "string" ? candidate : "";

	let refactored = modelCandidate.trim() ? modelCandidate : buildFallbackRefactoredCode(original, language);

	if (normalizeComparableCode(refactored) === normalizeComparableCode(original)) {
		refactored = buildFallbackRefactoredCode(original, language);
	}

	if (normalizeComparableCode(refactored) === normalizeComparableCode(original)) {
		refactored = original
			.replace(/[ \t]+$/gm, "")
			.replace(/\n{3,}/g, "\n\n");
	}

	if (normalizeComparableCode(refactored) === normalizeComparableCode(original)) {
		refactored = `${original}\n`;
	}

	return refactored;
}


function buildFallbackReview(code, language = "plaintext") {
	const heuristic = collectHeuristicFindings(code, language);
	const issues = heuristic.issues.length
		? heuristic.issues
		: [{ line: 1, message: "Add input validation for null/undefined values before property access.", severity: "warning" }];
	const suggestions = ensureMinimumSuggestions(heuristic.suggestions, issues, code);
	const score = computeQualityScore(issues, suggestions);

	return {
		issues,
		suggestions,
		refactoredCode: ensureAlwaysRefactoredCode(code, "", language),
		score,
	};
}

function buildLearningHint(code) {
	const source = typeof code === "string" ? code : "";
	const lines = source.split(/\r?\n/);

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (/\bconsole\.log\s*\(/.test(line)) {
			return {
				line: i + 1,
				step1: "Look at the line that prints debugging output.",
				step2: "Think about whether this should remain in code that users will run.",
				step3: "What approach would help you observe behavior without leaving noisy output behind?",
			};
		}

		if (/\bvar\b/.test(line)) {
			return {
				line: i + 1,
				step1: "Find the variable declaration that uses older scoping rules.",
				step2: "Consider how block scope could make this part of the code easier to reason about.",
				step3: "Which modern declaration style would fit this situation better?",
			};
		}

		if (/[^=!]==[^=]/.test(line)) {
			return {
				line: i + 1,
				step1: "Inspect the comparison on this line carefully.",
				step2: "Ask yourself whether implicit type conversion is desirable here.",
				step3: "How could you make the comparison behavior more predictable?",
			};
		}
	}

	return {
		line: 1,
		step1: "Your code looks stable; pick one edge-case input and predict what should happen.",
		step2: "Add a small test for that case and verify behavior matches your expectation.",
		step3: "Choose one best-practice refinement (naming, guard clause, or comments) without changing logic.",
	};
}

function buildFallbackLearningReview(code) {
	const hint = buildLearningHint(code);

	return {
		hints: [hint],
		score: clampScore(80),
	};
}

function normalizeIssue(item, maxLine, source = "") {
	if (!item || typeof item !== "object") {
		return null;
	}

	const message = sanitizeIssueMessage(item.message);
	if (!message) {
		return null;
	}

	let line = Number(item.line);
	if (!Number.isFinite(line)) {
		line = 1;
	}

	line = Math.max(1, Math.min(maxLine, Math.round(line)));

	const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";
	const codeElement = typeof item.codeElement === "string" && item.codeElement.trim() ? item.codeElement.trim() : inferCodeElement(message, source, line);
	const rawSeverity = typeof item.severity === "string" ? item.severity.toLowerCase().trim() : "";
	const severity = rawSeverity === "error" || rawSeverity === "suggestion" ? rawSeverity : "warning";
	const resolvedExplanation = explanation || buildIssueExplanation(message, source, line, severity);
	const type = typeof item.type === "string" && item.type.trim() ? item.type.trim().toLowerCase() : inferIssueType(message, severity);

	// Extract or generate fix object with before/after code
	let fix = { before: "", after: "" };
	if (item.fix && typeof item.fix === "object") {
		fix.before = String(item.fix.before || "").trim() || getLineText(source, line);
		fix.after = String(item.fix.after || "").trim();
	}
	
	// If fix is missing or incomplete, generate it
	if (!fix.before || !fix.after) {
		const generated = generateCodeFix({ line, message }, source);
		fix.before = fix.before || generated.before;
		fix.after = fix.after || generated.after;
	}

	return {
		line,
		issue: message,
		explanation: resolvedExplanation,
		fix: {
			before: fix.before,
			after: fix.after,
		},
		source: "ai",
		confidence: severity === "error" ? 0.80 : severity === "suggestion" ? 0.65 : 0.72,
	};
}

function normalizeSuggestion(item, maxLine) {
	return normalizeSuggestionShape(item, "", maxLine);
}

function normalizeLearningHint(item, maxLine) {
	if (!item || typeof item !== "object") {
		return null;
	}

	const step1 = typeof item.step1 === "string" ? item.step1.trim() : "";
	const step2 = typeof item.step2 === "string" ? item.step2.trim() : "";
	const step3 = typeof item.step3 === "string" ? item.step3.trim() : "";

	if (!step1 || !step2 || !step3) {
		return null;
	}

	let line = Number(item.line);
	if (!Number.isFinite(line)) {
		line = 1;
	}

	line = Math.max(1, Math.min(maxLine, Math.round(line)));

	return {
		line,
		step1,
		step2,
		step3,
	};
}

function parseModelJson(content) {
	try {
		return JSON.parse(content);
	} catch {
		const start = content.indexOf("{");
		const end = content.lastIndexOf("}");

		if (start === -1 || end === -1 || end <= start) {
			throw new Error("Model output is not valid JSON");
		}

		return JSON.parse(content.slice(start, end + 1));
	}
}

function normalizeResponse(data, code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";
	const maxLine = Math.max(1, source.split(/\r?\n/).length);

	const issues = Array.isArray(data?.issues)
		? data.issues
				.map((item) => normalizeIssue(item, maxLine, source))
				.filter((item) => item !== null)
		: [];

	const heuristic = collectHeuristicFindings(code, language);
	for (const issue of heuristic.issues) {
		const key = `${issue.line}|${issue.issue}`;
		const exists = issues.some((i) => `${i.line}|${i.issue}` === key);
		if (!exists) {
			issues.push(issue);
		}
	}

	if (issues.length === 0) {
		const defaultMsg = "Add input validation for null/undefined values before property access.";
		const fix = generateCodeFix({ line: 1, message: defaultMsg }, source);
		issues.push({
			line: 1,
			issue: defaultMsg,
			explanation: buildIssueExplanation(defaultMsg, source, 1, "warning"),
			fix: {
				before: fix.before,
				after: fix.after,
			},
			source: "ai",
			confidence: 0.65,
		});
	}

	const suggestions = Array.isArray(data?.suggestions)
		? data.suggestions
				.map((item) => normalizeSuggestionShape(item, source, maxLine))
				.filter((item) => item !== null)
		: [];

	for (const suggestion of heuristic.suggestions) {
		const key = `${suggestion.relatedLine}|${suggestion.improvementType}|${suggestion.message}`;
		const exists = suggestions.some((s) => `${s.relatedLine}|${s.improvementType}|${s.message}` === key);
		if (!exists) {
			suggestions.push(suggestion);
		}
	}

	const finalSuggestions = ensureMinimumSuggestions(suggestions, issues, source);

	const refactoredCode = ensureAlwaysRefactoredCode(source, data?.refactoredCode, language);

	const heuristicScore = computeQualityScore(issues, finalSuggestions);
	const modelScore = Number(data?.score);
	const score = Number.isFinite(modelScore)
		? clampScore(Math.round((modelScore * 0.35) + (heuristicScore * 0.65)))
		: heuristicScore;

	return {
		issues,
		suggestions: finalSuggestions,
		refactoredCode,
		score,
	};
}

function normalizeLearningResponse(data, code) {
	const source = typeof code === "string" ? code : "";
	const maxLine = Math.max(1, source.split(/\r?\n/).length);

	const hints = Array.isArray(data?.hints)
		? data.hints
				.map((item) => normalizeLearningHint(item, maxLine))
				.filter((item) => item !== null)
		: [];

	if (hints.length === 0) {
		hints.push(buildLearningHint(code));
	}

	return {
		hints,
		score: clampScore(data?.score ?? 80),
	};
}

function buildPrompt(code, mode, language = "plaintext") {
	const source = typeof code === "string" ? code : "";
	const baseFormat = `{"issues":[{"line":6,"codeElement":"input[index]","message":"Possible undefined access of input[index]","severity":"warning","explanation":"...","fix":{"before":"...","after":"..."}}],"suggestions":[{"message":"Line 7 (\\"for (let i = 0; i < users.length; i++)\\"): Rename 'i' to 'index'. This matters because intent is clearer and future edits are safer. Concrete improvement: use 'for (let index = 0; index < users.length; index += 1)'.","relatedLine":7,"improvementType":"readability"}],"refactoredCode":"...","score":72}`;

	if (mode === "learning") {
		return `You are a senior software engineer reviewing production-level code. The detected language is ${language}.\n\nYour job is NOT to be polite or generic. Your job is to find REAL issues and give ACTIONABLE feedback.\n\nSTRICT RULES:\n1) Be specific. Generic advice is forbidden.\n2) Return ONLY valid JSON in this exact shape: ${baseFormat}\n3) Every issue MUST include: line, codeElement, message, severity, explanation, and fix object.\n4) line must be an exact line reference for the issue.\n5) codeElement must name the specific variable, function, property, or statement causing the issue.\n6) message must clearly describe what the issue is.\n7) explanation must say why it is a problem in this code.\n8) fix object MUST have: before (exact code snippet from this line) and after (improved version with minimal changes).\n9) before must be the EXACT code from the target line (copy-paste from input).\n10) after must show the minimal fix applied (same line, but corrected).\n11) severity allowed values: error, warning, suggestion.\n12) Issues must cover runtime risks, logic bugs, edge cases, performance problems, and bad practices when present.\n13) Suggestions MUST be 3 to 5 items, each unique, and each MUST include exactly: message, relatedLine, improvementType.\n14) improvementType allowed values: readability, performance, safety.\n15) Every suggestion message MUST reference concrete code on the related line, explain why it matters, and suggest a specific improvement.\n16) No generic tips like \"improve readability\".\n17) refactoredCode MUST ALWAYS be returned and must improve structure, naming, and redundancy.\n18) score must be 0-100 based on correctness, readability, performance, and safety.\n19) Detect: off-by-one errors, null/undefined risks, unnecessary loops, duplicate logic, bad naming, missing edge handling.\n20) Output JSON only. No markdown, no prose, no extra keys.\n\nINPUT CODE:\n${source}`;
	}

	return `You are a senior software engineer reviewing production-level code. The detected language is ${language}.\n\nYour job is NOT to be polite or generic. Your job is to find REAL issues and give ACTIONABLE feedback.\n\nSTRICT RULES:\n1) Be specific. Generic advice is forbidden.\n2) Return ONLY valid JSON in this exact shape: ${baseFormat}\n3) Every issue MUST include: line, codeElement, message, severity, explanation, and fix object.\n4) line must be an exact line reference for the issue.\n5) codeElement must name the specific variable, function, property, or statement causing the issue.\n6) message must clearly describe what the issue is.\n7) explanation must say why it is a problem in this code.\n8) fix object MUST have: before (exact code snippet from this line) and after (improved version with minimal changes).\n9) before must be the EXACT code from the target line (copy-paste from input).\n10) after must show the minimal fix applied (same line, but corrected).\n11) severity allowed values: error, warning, suggestion.\n12) Issues must cover runtime risks, logic bugs, edge cases, performance problems, and bad practices when present.\n13) Suggestions MUST be 3 to 5 items, each unique, and each MUST include exactly: message, relatedLine, improvementType.\n14) improvementType allowed values: readability, performance, safety.\n15) Every suggestion message MUST reference concrete code on the related line, explain why it matters, and suggest a specific improvement.\n16) No generic tips like \"improve readability\".\n17) refactoredCode MUST ALWAYS be returned and must improve structure, naming, and redundancy.\n18) score must be 0-100 based on correctness, readability, performance, and safety.\n19) Detect: off-by-one errors, null/undefined risks, unnecessary loops, duplicate logic, bad naming, missing edge handling.\n20) Output JSON only. No markdown, no prose, no extra keys.\n\nINPUT CODE:\n${source}`;
}

function buildLearningPrompt(code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";
	const baseFormat = `{"hints":[{"line":1,"step1":"...","step2":"...","step3":"..."}],"score":85}`;

	return `You are an expert programming mentor. The detected language is ${language}. Given a code snippet, provide structured learning hints and return ONLY valid JSON in this exact format: ${baseFormat}. Code:\n${source}\nSTRICT RULES: NEVER return an empty hints array; ALWAYS provide at least 1 hint, even if code is correct; if no major issues, provide improvement hints focused on edge cases, best practices, readability, or scalability; DO NOT rewrite the code; DO NOT give final answers; DO NOT give direct fixes; keep hints concise and thoughtful; each hint must include: step1 as an indirect concern/improvement, step2 as a guiding question or hint, step3 as a deeper hint without full solution; line must be a positive integer; score must be a number 0-100; no markdown, no explanations, and no extra keys outside the JSON format.`;
}

async function analyzeWithOpenAI(code, mode = "review", language = "plaintext") {
	const openAIClient = getClient();
	if (!openAIClient) {
		return buildFallbackReview(code, language);
	}

	try {
		const completion = await openAIClient.chat.completions.create({
			model: "gpt-4o-mini",
			temperature: 0.1,
			messages: [
				{
					role: "system",
					content:
						mode === "learning"
							? "You are a strict code tutor. Output ONLY valid JSON."
							: "You are a strict code reviewer. Output ONLY valid JSON.",
				},
				{ role: "user", content: buildPrompt(code, mode, language) },
			],
		});

		const content = completion.choices?.[0]?.message?.content || "";
		const parsed = parseModelJson(content);

		return normalizeResponse(parsed, code, language);
	} catch (error) {
		console.error("OpenAI analyzeWithOpenAI error:", error.message || error);
		return buildFallbackReview(code, language);
	}
}

async function analyzeReviewWithOpenAI(code, language = "plaintext") {
	return analyzeWithOpenAI(code, "review", language);
}

async function analyzeLearningWithOpenAI(code, language = "plaintext") {
	const openAIClient = getClient();
	if (!openAIClient) {
		return buildFallbackLearningReview(code);
	}

	try {
		const completion = await openAIClient.chat.completions.create({
			model: "gpt-4o-mini",
			temperature: 0.1,
			messages: [
				{
					role: "system",
					content: "You are an expert programming mentor. Output ONLY valid JSON.",
				},
				{
					role: "user",
					content: buildLearningPrompt(code, language),
				},
			],
		});

		const content = completion.choices?.[0]?.message?.content || "";
		const parsed = parseModelJson(content);

		return normalizeLearningResponse(parsed, code);
	} catch (error) {
		console.error("OpenAI analyzeLearningWithOpenAI error:", error.message || error);
		return buildFallbackLearningReview(code);
	}
}

async function answerFollowUpQuestion(code, issues, suggestions, refactoredCode, question) {
	const openaiClient = getClient();
	if (!openaiClient) {
		return {
			answer: "OpenAI API key not configured.",
			references: [],
		};
	}

	const safeCode = String(code || "").slice(0, 12000);
	const safeRefactoredCode = String(refactoredCode || "").slice(0, 12000);
	const safeIssues = Array.isArray(issues) ? issues.slice(0, 40) : [];
	const safeSuggestions = Array.isArray(suggestions) ? suggestions.slice(0, 40) : [];
	const safeQuestion = String(question || "").slice(0, 1000);

	const fallbackReferences = [...safeIssues, ...safeSuggestions]
		.slice(0, 3)
		.map((item) => ({
			line: Number.isFinite(Number(item?.line)) ? Math.max(1, Math.round(Number(item.line))) : 1,
			reason: typeof item?.message === "string" && item.message.trim() ? item.message.trim() : "Relevant finding from current analysis.",
		}));

	const relatedTerms = ["code", "issue", "issues", "suggestion", "suggestions", "line", "error", "warning", "analysis", "refactor", "bug", "function", "variable", "logic"];
	const loweredQuestion = safeQuestion.toLowerCase();
	const isLikelyRelated = relatedTerms.some((term) => loweredQuestion.includes(term)) || fallbackReferences.length > 0;

	const fallbackAnswer = isLikelyRelated
		? "Rate limit is active right now, so this answer is based on the latest findings only. Review the referenced lines first because they are the strongest signals tied to your current analysis."
		: "This question is not related to the current code analysis.";

	try {
		const mentorPrompt = `You are an AI code mentor helping a user understand THEIR OWN analyzed code.

You are given:
1. The original code
2. Detected issues
3. Suggestions
4. (Optional) Refactored code
5. A user follow-up question

---------------------------------------
STRICT RULES:
---------------------------------------

1. ONLY answer using the given context.
   - Refer to specific lines, issues, or suggestions
   - DO NOT give generic programming advice

2. If the question is unrelated to the code or analysis:
   - Respond: "This question is not related to the current code analysis."

3. Be precise and technical:
   - Mention line numbers if possible
   - Explain WHY, not just WHAT

4. Do NOT rewrite the entire code unless explicitly asked.

5. Keep answers concise but meaningful.

---------------------------------------
RESPOND IN THIS JSON FORMAT ONLY:
---------------------------------------

{
  "answer": "clear explanation",
  "references": [
    {
      "line": number,
      "reason": "why this part is relevant"
    }
  ]
}

---------------------------------------
CONTEXT:
---------------------------------------

CODE:
\`\`\`
${safeCode}
\`\`\`

ISSUES:
${JSON.stringify(safeIssues, null, 2)}

SUGGESTIONS:
${JSON.stringify(safeSuggestions, null, 2)}

REFACTORED_CODE:
${safeRefactoredCode ? '\`\`\`\n' + safeRefactoredCode + '\n\`\`\`' : '(No refactored code available)'}

USER QUESTION:
${safeQuestion}`;

		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const completion = await openaiClient.chat.completions.create({
					model: "gpt-4o-mini",
					messages: [
						{
							role: "user",
							content: mentorPrompt,
						},
					],
					temperature: 0.2,
					max_tokens: attempt === 0 ? 350 : 220,
				});

				const content = completion.choices?.[0]?.message?.content || "";
				const parsed = parseModelJson(content);

				return {
					answer: typeof parsed?.answer === "string" ? parsed.answer : "Could not parse response.",
					references: Array.isArray(parsed?.references) ? parsed.references : [],
				};
			} catch (attemptError) {
				const attemptStatus = Number(attemptError?.status || 0);
				if (attemptStatus !== 429 || attempt === 1) {
					throw attemptError;
				}
			}
		}
	} catch (error) {
		console.error("OpenAI answerFollowUpQuestion error:", error.message || error);
		const status = Number(error?.status || 0);
		const rawMessage = typeof error?.message === "string" ? error.message : "";
		const lowered = rawMessage.toLowerCase();

		let answer = "Follow-up request failed. Please try again.";
		if (status === 401) {
			answer = "Follow-up failed: OpenAI authentication failed on the server.";
		} else if (status === 429) {
			answer = fallbackAnswer;
		} else if (status >= 500) {
			answer = "Follow-up failed: AI service is temporarily unavailable.";
		} else if (lowered.includes("context length") || lowered.includes("maximum context") || lowered.includes("too many tokens")) {
			answer = "Follow-up failed: analysis context is too large. Try a shorter question or smaller code snippet.";
		} else if (rawMessage) {
			answer = `Follow-up failed: ${rawMessage}`;
		}

		return {
			answer,
			references: status === 429 ? fallbackReferences : [],
		};
	}
}

module.exports = {
	analyzeWithOpenAI,
	analyzeReviewWithOpenAI,
	analyzeLearningWithOpenAI,
	answerFollowUpQuestion,
};
