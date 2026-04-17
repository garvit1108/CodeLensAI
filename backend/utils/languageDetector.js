function detectLanguageFromCode(code) {
	const source = typeof code === "string" ? code : "";
	const sample = source.slice(0, 5000);

	if (!sample.trim()) {
		return "plaintext";
	}

	const checks = [
		{
			language: "python",
			score: () =>
				(sample.match(/\bdef\s+[a-zA-Z_]\w*\s*\(/g) || []).length * 3 +
				(sample.match(/\bimport\s+[a-zA-Z_][\w.]*\b/g) || []).length * 2 +
				(sample.match(/:\s*(\n|#)/g) || []).length,
		},
		{
			language: "java",
			score: () =>
				(sample.match(/\bpublic\s+class\b/g) || []).length * 4 +
				(sample.match(/\bSystem\.out\.println\s*\(/g) || []).length * 3 +
				(sample.match(/\bprivate\s+\w+[\[\]]*\s+\w+\s*[;=]/g) || []).length,
		},
		{
			language: "csharp",
			score: () =>
				(sample.match(/\busing\s+[A-Z][\w.]*\s*;/g) || []).length * 3 +
				(sample.match(/\bnamespace\s+[A-Z][\w.]*/g) || []).length * 3 +
				(sample.match(/\bConsole\.WriteLine\s*\(/g) || []).length * 2,
		},
		{
			language: "cpp",
			score: () =>
				(sample.match(/#include\s*<[^>]+>/g) || []).length * 3 +
				(sample.match(/\bstd::\w+/g) || []).length * 2 +
				(sample.match(/\bcout\s*<</g) || []).length * 2,
		},
		{
			language: "go",
			score: () =>
				(sample.match(/\bpackage\s+main\b/g) || []).length * 4 +
				(sample.match(/\bfunc\s+[A-Za-z_]\w*\s*\(/g) || []).length * 2 +
				(sample.match(/\bfmt\.Println\s*\(/g) || []).length * 2,
		},
		{
			language: "javascript",
			score: () =>
				(sample.match(/\b(const|let|var)\s+[A-Za-z_$][\w$]*/g) || []).length * 2 +
				(sample.match(/=>/g) || []).length +
				(sample.match(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g) || []).length * 2,
		},
		{
			language: "typescript",
			score: () =>
				(sample.match(/\binterface\s+[A-Z][\w]*/g) || []).length * 3 +
				(sample.match(/\btype\s+[A-Z][\w]*\s*=\s*/g) || []).length * 3 +
				(sample.match(/:\s*[A-Za-z_$][\w$<>,\[\]\s|&]*/g) || []).length,
		},
	];

	let best = { language: "plaintext", score: 0 };
	for (const check of checks) {
		const score = check.score();
		if (score > best.score) {
			best = { language: check.language, score };
		}
	}

	return best.score > 0 ? best.language : "plaintext";
}

module.exports = {
	detectLanguageFromCode,
};
