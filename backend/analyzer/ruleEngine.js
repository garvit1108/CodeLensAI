const { performRuleBasedAnalysis } = require("../services/ruleBasedValidationService");
const { validateSyntaxBeforeAnalysis } = require("../services/syntaxValidationService");

function runRuleEngine(code, language = "plaintext") {
	const source = typeof code === "string" ? code : "";
	const ruleAnalysis = performRuleBasedAnalysis(source, language);
	const syntaxValidation = validateSyntaxBeforeAnalysis(source, language);

	return {
		ruleAnalysis,
		syntaxValidation,
	};
}

module.exports = {
	runRuleEngine,
};
