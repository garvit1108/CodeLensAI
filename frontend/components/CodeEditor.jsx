import { useState } from "react";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const initialAnalysis = {
	issues: [],
	suggestions: [],
	refactored_code: "",
	complexity: null,
};

export default function CodeEditor() {
	const [code, setCode] = useState(`function reviewTarget(input) {
	if (!input) return null;
	const result = [];
	for (let i = 0; i < input.length; i++) {
		if (input[i].active) {
			result.push(input[i].value * 2);
		}
	}
	return result;
}`);
	const [analysis, setAnalysis] = useState(initialAnalysis);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	async function handleAnalyze() {
		setIsLoading(true);
		setError("");

		try {
			const response = await fetch("http://localhost:5000/api/analyze", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ code }),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Failed to analyze code (${response.status}): ${errorText || "Unknown error"}`);
			}

			const data = await response.json();
			setAnalysis({
				issues: Array.isArray(data.issues) ? data.issues : [],
				suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
				refactored_code:
					typeof data.refactored_code === "string" ? data.refactored_code : "",
				complexity: data.complexity ?? "N/A",
			});
		} catch (requestError) {
			setError(requestError.message || "Something went wrong.");
		} finally {
			setIsLoading(false);
		}
	}

	const complexityValue =
		typeof analysis.complexity === "string" && analysis.complexity.trim().length > 0
			? analysis.complexity
			: "N/A";
	const isComplexityHigh = complexityValue.includes("n^2") || complexityValue.includes("n2");

	return (
		<div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#1e293b_0%,#0f172a_40%,#020617_100%)] px-4 py-6 sm:px-6 lg:px-8">
			<div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
				<h1 className="text-xl font-bold tracking-tight text-slate-100 sm:text-2xl">AI Code Reviewer</h1>
				<button
					type="button"
					className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
					onClick={handleAnalyze}
					disabled={isLoading}
				>
					{isLoading ? <Spinner /> : null}
					{isLoading ? "Analyzing..." : "Analyze Code"}
				</button>
			</div>

			<div className="mx-auto mt-4 grid w-full max-w-7xl grid-cols-1 gap-4 lg:grid-cols-12">
				<section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl lg:col-span-7">
					<div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
						Editor
					</div>
					<div className="h-[520px]">
						<MonacoEditor
							height="100%"
							defaultLanguage="javascript"
							value={code}
							onChange={(value) => setCode(value || "")}
							theme="vs-dark"
							options={{
								minimap: { enabled: false },
								fontSize: 14,
								scrollBeyondLastLine: false,
								automaticLayout: true,
								wordWrap: "on",
								padding: { top: 14 },
							}}
						/>
					</div>
				</section>

				<aside className="space-y-4 lg:col-span-5">
					<div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Complexity</h2>
							<span
								className={`rounded-full px-3 py-1 text-xs font-bold ${
									isComplexityHigh
										? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/40"
										: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
								}`}
							>
								{complexityValue}
							</span>
						</div>
						<p className="text-xs text-slate-400">
							Detected from structural analysis. Nested loops push complexity toward quadratic growth.
						</p>
					</div>

					{error ? (
						<div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-200">
							{error}
						</div>
					) : null}

					<HighlightList title="Issues" items={analysis.issues} variant="issues" />
					<HighlightList title="Suggestions" items={analysis.suggestions} variant="suggestions" />

					<div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
						<h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">Refactored Code</h3>
						<pre className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-200">
							{analysis.refactored_code || "No refactored code yet."}
						</pre>
					</div>
				</aside>
			</div>
		</div>
	);
}

function HighlightList({ title, items, variant }) {
	const isIssueVariant = variant === "issues";

	return (
		<div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
			<h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h3>
			{items.length > 0 ? (
				<ul className="space-y-2">
					{items.map((item, index) => (
						<li
							key={`${title}-${index}`}
							className={`rounded-lg border p-3 text-sm leading-5 ${
								isIssueVariant
									? "border-rose-500/40 bg-rose-950/40 text-rose-100"
									: "border-blue-500/40 bg-blue-950/40 text-blue-100"
							}`}
						>
							{isIssueVariant ? "Issue: " : "Tip: "}
							{item}
						</li>
					))}
				</ul>
			) : (
				<p className="text-xs text-slate-400">No data yet.</p>
			)}
		</div>
	);
}

function Spinner() {
	return (
		<span
			className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
			aria-hidden="true"
		/>
	);
}
