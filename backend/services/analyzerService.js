const TreeSitter = require("web-tree-sitter");

const LOOP_NODE_TYPES = new Set([
	"for_statement",
	"for_in_statement",
	"for_of_statement",
	"while_statement",
	"do_statement",
]);

const FUNCTION_NODE_TYPES = new Set([
	"function_declaration",
	"function_expression",
	"arrow_function",
	"generator_function_declaration",
	"generator_function",
	"method_definition",
]);

const NESTING_NODE_TYPES = new Set([
	"if_statement",
	"for_statement",
	"for_in_statement",
	"for_of_statement",
	"while_statement",
	"do_statement",
	"switch_statement",
	"try_statement",
	"catch_clause",
	"with_statement",
]);

const MAX_FUNCTION_LINES = 30;
const MAX_FUNCTION_PARAMETERS = 4;
const MAX_NESTING_DEPTH = 3;

let parserPromise;

async function getParser() {
	if (!parserPromise) {
		parserPromise = (async () => {
			await TreeSitter.Parser.init();
			const language = await TreeSitter.Language.load(
				require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm")
			);

			const parser = new TreeSitter.Parser();
			parser.setLanguage(language);
			return parser;
		})();
	}

	return parserPromise;
}

async function analyzeStructure(code) {
	const parser = await getParser();

	const tree = parser.parse(typeof code === "string" ? code : "");
	const result = {
		complexity: "O(n)",
		warnings: [],
	};
	const warningSet = new Set();

	function addWarning(message) {
		if (warningSet.has(message)) {
			return;
		}

		warningSet.add(message);
		result.warnings.push(message);
	}

	function getFunctionName(node) {
		const nameNode = node.childForFieldName("name");
		if (!nameNode) {
			return "Anonymous function";
		}

		return nameNode.text || "Anonymous function";
	}

	function getParameterCount(node) {
		const parametersNode = node.childForFieldName("parameters");
		if (!parametersNode) {
			return 0;
		}

		return parametersNode.namedChildren.length;
	}

	function walk(node, loopDepth, nestingDepth) {
		const isFunction = FUNCTION_NODE_TYPES.has(node.type);
		let nextLoopDepth = isFunction ? 0 : loopDepth;
		let nextNestingDepth = isFunction ? 0 : nestingDepth;

		if (isFunction) {
			const functionLength = node.endPosition.row - node.startPosition.row + 1;
			if (functionLength > MAX_FUNCTION_LINES) {
				addWarning(
					`${getFunctionName(node)} is ${functionLength} lines long (max ${MAX_FUNCTION_LINES}).`
				);
			}

			const parameterCount = getParameterCount(node);
			if (parameterCount > MAX_FUNCTION_PARAMETERS) {
				addWarning(
					`${getFunctionName(node)} has ${parameterCount} parameters (max ${MAX_FUNCTION_PARAMETERS}).`
				);
			}
		}

		const isLoop = LOOP_NODE_TYPES.has(node.type);
		if (isLoop) {
			nextLoopDepth += 1;
			if (nextLoopDepth >= 2) {
				result.complexity = "O(n^2)";
				addWarning("Nested loops detected; estimated complexity is O(n^2).");
			}
		}

		const isNestingNode = NESTING_NODE_TYPES.has(node.type);
		if (isNestingNode) {
			nextNestingDepth += 1;
			if (nextNestingDepth > MAX_NESTING_DEPTH) {
				addWarning(`Nesting depth exceeds ${MAX_NESTING_DEPTH} levels.`);
			}
		}

		for (const child of node.namedChildren) {
			walk(child, nextLoopDepth, nextNestingDepth);
		}
	}

	walk(tree.rootNode, 0, 0);

	return result;
}

module.exports = {
	analyzeStructure,
};
