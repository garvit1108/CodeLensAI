/**
 * Rule-Based Validation Service
 * 
 * Runs deterministic, high-confidence rule checks BEFORE AI analysis.
 * Provides hybrid system: Rules for certain issues + AI for nuanced analysis.
 * 
 * Rules implemented:
 * 1. Missing semicolons (JS/TS)
 * 2. Null/undefined checks before property access
 * 3. Off-by-one loop errors (i <= length)
 * 4. Unused variables
 * 5. Invalid/empty input handling
 */

const JS_LIKE_LANGUAGES = new Set(["javascript", "typescript"]);

function getLineText(source, lineNumber) {
	const lines = String(source || "").split(/\r?\n/);
	const line = Number(lineNumber);
	if (!Number.isFinite(line) || line < 1 || line > lines.length) {
		return "";
	}
	return lines[Math.floor(line) - 1];
}

function getTrimmedLineText(source, lineNumber) {
	return getLineText(source, lineNumber).trim();
}

/**
 * Rule 1: Missing Semicolons
 * Detects statements that should end with semicolons
 */
function checkMissingSemicolons(source) {
	const issues = [];
	const lines = source.split(/\r?\n/);
	const C_STYLE_KEYWORDS = new Set(["if", "for", "while", "switch", "try", "catch", "do", "function", "class", "interface", "type", "namespace", "import", "export"]);

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		
		// Skip empty lines, comments, and control structures
		if (!trimmed || /^\/\//.test(trimmed) || /^\/\*/.test(trimmed) || /^\*/.test(trimmed) || /^#/.test(trimmed)) {
			continue;
		}

		const startsWithControl = Array.from(C_STYLE_KEYWORDS).some(kw => new RegExp(`^${kw}\\b`).test(trimmed));
		if (startsWithControl) continue;

		// Check if line looks like a statement and doesn't end with statement terminator
		const looksLikeStatement = /[A-Za-z0-9_\]\)'"]$/.test(trimmed);
		const endsWithTerminator = /[;{}:,]$/.test(trimmed);
		const isMethodCall = /\)\s*$/.test(trimmed);
		const isAssignment = /=\s*(?:(?:async\s+)?(?:function|\([^)]*\)|[^=;]+))?$/.test(trimmed);
		const isVariableDeclaration = /^\s*(?:const|let|var)\s+/.test(trimmed);

		if (looksLikeStatement && !endsWithTerminator && (isMethodCall || isAssignment || isVariableDeclaration)) {
			issues.push({
				line: i + 1,
				codeElement: trimmed.substring(0, 40) + (trimmed.length > 40 ? "..." : ""),
				message: "Missing semicolon at end of statement",
				explanation: "Statements should end with semicolons. Without them, JavaScript ASI (Automatic Semicolon Insertion) can produce unexpected results.",
				fixSuggestion: `Add semicolon: ${trimmed};`,
				severity: "warning",
				type: "syntax",
				source: "rule",
			confidence: 0.98,
			});
		}
	}

	return issues;
}

/**
 * Rule 2: Null/Undefined Checks
 * Detects property access without null checks
 */
function checkNullPropertyAccess(source) {
	const issues = [];
	const lines = source.split(/\r?\n/);
	const variableNames = new Set();

	// First pass: collect all variable assignments (naive approach)
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:null|undefined|[^;]+\?|\.\.\.|async|new|fetch|axios|http|get|find|filter)/);
		if (match?.[1]) {
			variableNames.add(match[1]);
		}
	}

	// Second pass: find property accesses on potentially null variables
	const propertyAccessPattern = /\b([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)/g;
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Skip if line already has null check
		if (/if\s*\(|guard|optional|^\s*if\s*\(.*==|!=|===|!==/.test(trimmed)) continue;
		if (/\?\.|\?\?/.test(line)) continue; // Optional chaining

		let match;
		while ((match = propertyAccessPattern.exec(line)) !== null) {
			const varName = match[1];
			const property = match[2];

			if (variableNames.has(varName) && !/this|super|window|document|console/.test(varName)) {
				// High confidence that this needs a null check
				issues.push({
					line: i + 1,
					codeElement: `${varName}.${property}`,
					message: `Potential null/undefined property access on '${varName}'`,
					explanation: `Variable '${varName}' may be null or undefined. Accessing '.${property}' without a guard check could throw a runtime error.`,
					fixSuggestion: `Add guard clause: if (${varName} != null) { ... } or use optional chaining: ${varName}?.${property}`,
					severity: "error",
					type: "runtime",
					source: "rule",
				confidence: 0.93,
				});
			}
		}
	}

	return issues;
}

/**
 * Rule 3: Off-by-one Loop Errors
 * Detects i <= length patterns in loops
 */
function checkOffByOneErrors(source) {
	const issues = [];
	const lines = source.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Pattern: for (...; i <= array.length; ...)
		if (/\bfor\s*\([^)]*;\s*\w+\s*<=\s*(\w+\.length|[a-zA-Z_$][\w$]*\.length)/i.test(line)) {
			const arrayMatch = line.match(/(\w+)\.length/);
			const arrayName = arrayMatch?.[1] || "array";

			issues.push({
				line: i + 1,
				codeElement: line.match(/\bfor\s*\([^)]*\)/)?.[0] || "for loop",
				message: "Possible off-by-one error: using <= with array.length",
				explanation: `Using 'i <= ${arrayName}.length' will iterate beyond the array bounds. Arrays are 0-indexed, so valid indices are 0 to length-1. This will cause index out of bounds errors.`,
				fixSuggestion: `Change to 'i < ${arrayName}.length' (use < instead of <=)`,
				severity: "error",
				type: "logic",
				source: "rule",
			confidence: 0.96,
			});
		}

		// Pattern: for (...; i <= someValue; ...) where someValue looks like a collection
		if (/\bfor\s*\([^)]*;\s*\w+\s*<=\s*(\w+)\s*;/i.test(line)) {
			const match = line.match(/\bfor\s*\([^)]*;\s*(\w+)\s*<=\s*(\w+)\s*;/i);
			if (match && /arr|items|list|collection|data|elements|nodes/.test(match[2].toLowerCase())) {
				issues.push({
					line: i + 1,
					codeElement: line.match(/\bfor\s*\([^)]*\)/)?.[0] || "for loop",
					message: "Likely off-by-one error: using <= with collection variable",
					explanation: `Loop condition '${match[1]} <= ${match[2]}' may iterate beyond valid indices for a collection.`,
					fixSuggestion: `Review loop bounds. Use 'i < ${match[2]}' for standard 0-indexed iteration.`,
					severity: "warning",
					type: "logic",
					source: "rule",
				confidence: 0.90,
				});
			}
		}
	}

	return issues;
}

/**
 * Rule 4: Unused Variables
 * Detects variables that are declared but never used
 */
function checkUnusedVariables(source) {
	const issues = [];
	const declarationRegex = /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\b/g;
	const seenVars = new Map();

	// Collect all declarations
	let match;
	while ((match = declarationRegex.exec(source)) !== null) {
		const varName = match[1];
		const lineNum = source.substring(0, match.index).split(/\r?\n/).length;
		
		if (!seenVars.has(varName)) {
			seenVars.set(varName, { line: lineNum, usages: 0 });
		}
	}

	// Count usages (excluding declaration line)
	for (const [varName, info] of seenVars) {
		// Create regex that matches the variable name as a whole word, but not in declaration
		const usageRegex = new RegExp(`\\b${varName}\\b`, "g");
		let usageCount = 0;

		const lines = source.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			
			// Skip the declaration line itself
			if (i + 1 === info.line && /\b(?:const|let|var)\s+\b/.test(line)) {
				continue;
			}

			const matches = line.match(usageRegex);
			usageCount += matches ? matches.length : 0;
		}

		// Variable declared but never used
		if (usageCount === 0 && !/^_/.test(varName)) { // Allow underscore-prefixed vars as intentionally unused
			const lineText = getTrimmedLineText(source, info.line);
			issues.push({
				line: info.line,
				codeElement: varName,
				message: `Unused variable '${varName}'`,
				explanation: `Variable '${varName}' is declared but never used. This increases code complexity and may indicate incomplete logic or dead code.`,
				fixSuggestion: `Either use the variable in your logic or remove the declaration.`,
				severity: "warning",
				type: "maintainability",
				source: "rule",
			confidence: 0.95,
			});
		}
	}

	return issues;
}

/**
 * Rule 5: Invalid/Empty Input Handling
 * Detects missing input validation at function entry points
 */
function checkMissingInputValidation(source) {
	const issues = [];
	const lines = source.split(/\r?\n/);
	
	// Find function declarations/definitions
	const functionPattern = /\b(?:function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=)\s*\(([^)]*)\)/g;
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		
		// Look for function definitions with parameters
		const match = line.match(/\(([^)]+)\)\s*(?:=>|{)/);
		if (!match || match[1].trim().length === 0) continue;

		const params = match[1].split(",").map(p => p.trim().split("=")[0].trim()).filter(p => p);
		
		// Check next 5 lines for input validation
		let hasValidation = false;
		for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
			const checkLine = lines[j];
			if (/if\s*\(|throw\s+new\s+Error|guard|return|null|undefined|required/.test(checkLine)) {
				hasValidation = true;
				break;
			}
		}

		// If function has parameters and no obvious validation in first 5 lines
		if (params.length > 0 && !hasValidation && !/test|mock|stub|fixture/.test(line.toLowerCase())) {
			const paramList = params.join(", ");
			issues.push({
				line: i + 1,
				codeElement: `function (${paramList})`,
				message: "Missing input validation for function parameters",
				explanation: `Function accepts parameters (${paramList}) but no input validation is detected in the first few lines. Functions should validate their inputs to prevent invalid states and runtime errors.`,
				fixSuggestion: `Add parameter validation at the start of the function: Check for null/undefined, correct types, or constraints.`,
				severity: "suggestion",
				type: "validation",
				source: "rule",
			confidence: 0.91,
			});
		}
	}

	return issues;
}

/**
 * Main validation function - runs all rule checks
 * Returns issues with source: "rule" for easy tracking
 */
function performRuleBasedAnalysis(code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";

	// Return empty if not applicable language
	if (!source.trim() || !JS_LIKE_LANGUAGES.has(language)) {
		return {
			issues: [],
			hasCriticalIssues: false,
		};
	}

	const allIssues = [];
	const issueKeys = new Set();

	try {
		// Rule 1: Missing semicolons
		const semicolonIssues = checkMissingSemicolons(source);
		for (const issue of semicolonIssues) {
			const key = `${issue.line}|${issue.severity}|${issue.message}`;
			if (!issueKeys.has(key)) {
				issueKeys.add(key);
				allIssues.push(issue);
			}
		}

		// Rule 2: Null/undefined checks
		const nullCheckIssues = checkNullPropertyAccess(source);
		for (const issue of nullCheckIssues) {
			const key = `${issue.line}|${issue.severity}|${issue.message}`;
			if (!issueKeys.has(key)) {
				issueKeys.add(key);
				allIssues.push(issue);
			}
		}

		// Rule 3: Off-by-one errors
		const offByOneIssues = checkOffByOneErrors(source);
		for (const issue of offByOneIssues) {
			const key = `${issue.line}|${issue.severity}|${issue.message}`;
			if (!issueKeys.has(key)) {
				issueKeys.add(key);
				allIssues.push(issue);
			}
		}

		// Rule 4: Unused variables
		const unusedVarIssues = checkUnusedVariables(source);
		for (const issue of unusedVarIssues) {
			const key = `${issue.line}|${issue.severity}|${issue.message}`;
			if (!issueKeys.has(key)) {
				issueKeys.add(key);
				allIssues.push(issue);
			}
		}

		// Rule 5: Missing input validation
		const inputValidationIssues = checkMissingInputValidation(source);
		for (const issue of inputValidationIssues) {
			const key = `${issue.line}|${issue.severity}|${issue.message}`;
			if (!issueKeys.has(key)) {
				issueKeys.add(key);
				allIssues.push(issue);
			}
		}
	} catch (error) {
		// Rules should never fail silently - log but continue
		console.error("Rule-based validation error:", error.message || error);
		// Return what we have so far, don't stop analysis
		return {
			issues: allIssues,
			hasCriticalIssues: allIssues.some(i => i.severity === "error"),
		};
	}

	// Sort by line number for consistency
	allIssues.sort((a, b) => a.line - b.line);

	return {
		issues: allIssues,
		hasCriticalIssues: allIssues.some(i => i.severity === "error"),
	};
}

module.exports = {
	performRuleBasedAnalysis,
	checkMissingSemicolons,
	checkNullPropertyAccess,
	checkOffByOneErrors,
	checkUnusedVariables,
	checkMissingInputValidation,
};
