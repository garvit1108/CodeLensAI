"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { buildApiUrl } from "../utils/api";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const initialAnalysis = {
	issues: [],
	suggestions: [],
	hints: [],
	refactored_code: "",
	complexity: null,
	degraded: false,
};

const renderSafe = (value) => {
	if (value === null || value === undefined) return "";
	if (typeof value === "string" || typeof value === "number") return value;
	return JSON.stringify(value);
};

function buildDiffRows(originalCode, refactoredCode) {
	const originalLines = String(originalCode || "").split(/\r?\n/);
	const refactoredLines = String(refactoredCode || "").split(/\r?\n/);
	const total = Math.max(originalLines.length, refactoredLines.length);
	const rows = [];

	for (let index = 0; index < total; index += 1) {
		const left = originalLines[index] ?? "";
		const right = refactoredLines[index] ?? "";
		let type = "same";

		if (!left && right) {
			type = "added";
		} else if (left && !right) {
			type = "removed";
		} else if (left !== right) {
			type = "changed";
		}

		rows.push({
			lineNumber: index + 1,
			left,
			right,
			type,
		});
	}

	return rows;
}

export default function CodeEditor() {
	const editorRef = useRef(null);
	const monacoRef = useRef(null);
	const decorationIdsRef = useRef([]);
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
	const [mode, setMode] = useState("review");
	const [error, setError] = useState("");
	const [fixMessage, setFixMessage] = useState("");
	const [isEditorFocused, setIsEditorFocused] = useState(false);
	const [currentQuestion, setCurrentQuestion] = useState("");
	const [isQaLoading, setIsQaLoading] = useState(false);
	const [qaError, setQaError] = useState("");
	const [latestQa, setLatestQa] = useState(null);
	const [activeIssueLine, setActiveIssueLine] = useState(null);

	function handleLogout() {
		localStorage.removeItem("token");
		if (typeof window !== "undefined") {
			window.location.assign("/login");
		}
	}

	async function handleAnalyze() {
		if (isLoading) {
			return;
		}

		setIsLoading(true);
		setError("");
		setFixMessage("");
		setQaError("");
		setLatestQa(null);

		try {
			const token = localStorage.getItem("token");
			if (!token) {
				throw new Error("You must log in first to analyze code.");
			}

			const response = await fetch(buildApiUrl("/api/analyze"), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ code, mode }),
			});

			if (!response.ok) {
				const rawText = await response.text();
				let apiError = "";
				try {
					apiError = JSON.parse(rawText)?.error || "";
				} catch {
					apiError = rawText;
				}

				if (response.status === 401) {
					localStorage.removeItem("token");
					setError("Your session is invalid or expired. Please log in again.");
					if (typeof window !== "undefined") {
						window.location.assign("/login");
					}
					return;
				}

				if (response.status >= 500) {
					throw new Error("Server error while analyzing code. Please try again shortly.");
				}

				throw new Error(apiError || `Failed to analyze code (${response.status}).`);
			}

			const data = await response.json();

			if ((data?.mode || mode) === "learning") {
				const hints = Array.isArray(data?.hints) ? data.hints : [];
				const learningIssues = hints.map((hint, index) => ({
					line: Number.isFinite(Number(hint?.line)) ? Math.max(1, Math.round(Number(hint.line))) : 1,
					severity: "suggestion",
					message:
						typeof hint?.step1 === "string" && hint.step1.trim().length > 0
							? hint.step1.trim()
							: `Learning hint ${index + 1}`,
					explanation: [hint?.step2, hint?.step3]
						.filter((step) => typeof step === "string" && step.trim().length > 0)
						.join(" "),
				}));

				const learningSuggestions = hints.map((hint) => ({
					line: Number.isFinite(Number(hint?.line)) ? Math.max(1, Math.round(Number(hint.line))) : 1,
					message: [hint?.step1, hint?.step2, hint?.step3]
						.filter((step) => typeof step === "string" && step.trim().length > 0)
						.join(" -> "),
				}));

				setAnalysis({
					issues: learningIssues,
					suggestions: learningSuggestions,
					hints,
					refactored_code: "",
					complexity: "Learning mode",
					degraded: false,
				});
				return;
			}

			const refactoredCode =
				typeof data?.refactoredCode === "string"
					? data.refactoredCode
					: typeof data?.refactored_code === "string"
						? data.refactored_code
						: "";
			setAnalysis({
				issues: Array.isArray(data.issues) ? data.issues : [],
				suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
				hints: [],
				refactored_code: refactoredCode,
				complexity: data.complexity ?? "N/A",
				degraded: Boolean(data?.degraded),
			});
		} catch (requestError) {
			setError(requestError.message || "Something went wrong.");
		} finally {
			setIsLoading(false);
		}
	}

	function handleClearCode() {
		setCode("");
		setError("");
		setFixMessage("");
		setLatestQa(null);
		setCurrentQuestion("");
		setQaError("");
	}

	function handleApplyFix() {
		const refactored =
			typeof analysis?.refactored_code === "string" ? analysis.refactored_code : "";
		if (!refactored.trim()) {
			return;
		}

		setCode(refactored);
		setFixMessage("Refactored code applied to editor.");
	}

	function handleNavigateToIssue(item) {
		const editor = editorRef.current;
		if (!editor) {
			return;
		}

		const model = editor.getModel();
		const maxLine = Math.max(1, model?.getLineCount?.() || 1);
		const lineNumber = toLineNumber(item?.line, maxLine);
		setActiveIssueLine(lineNumber);

		editor.revealLineInCenter(lineNumber);
		editor.setPosition({
			lineNumber,
			column: 1,
		});
		editor.focus();
	}

	async function handlePasteCode() {
		try {
			const pastedText = await navigator.clipboard.readText();
			if (!pastedText) {
				setError("Clipboard is empty.");
				return;
			}

			setCode(pastedText);
			setError("");
		} catch {
			setError("Clipboard paste is not available in this browser context.");
		}
	}

	async function handleFormatCode() {
		const editor = editorRef.current;
		const formatAction = editor?.getAction?.("editor.action.formatDocument");

		if (!formatAction) {
			setError("Formatting is not available right now.");
			return;
		}

		setError("");
		await formatAction.run();
	}

	function getMarkerSeverity(monaco, severity) {
		const normalized = typeof severity === "string" ? severity.toLowerCase().trim() : "warning";
		if (normalized === "error") return monaco.MarkerSeverity.Error;
		if (normalized === "suggestion") return monaco.MarkerSeverity.Info;
		return monaco.MarkerSeverity.Warning;
	}

	function toLineNumber(rawLine, maxLine) {
		const line = Number(rawLine);
		if (!Number.isFinite(line)) {
			return 1;
		}

		return Math.max(1, Math.min(maxLine, Math.round(line)));
	}

	function applyAnalysisMarkers(sourceCode, analysisResult) {
		const editor = editorRef.current;
		const monaco = monacoRef.current;
		if (!editor || !monaco) return;

		const model = editor.getModel();
		if (!model) return;

		const lines = String(sourceCode || "").split(/\r?\n/);
		const maxLine = Math.max(1, lines.length);
		const markers = [];
		const decorations = [];

		const issueItems = Array.isArray(analysisResult?.issues) ? analysisResult.issues : [];
		for (const item of issueItems) {
			const lineNumber = toLineNumber(item?.line, maxLine);
			const lineText = lines[lineNumber - 1] || "";
			const normalizedSeverity = typeof item?.severity === "string" ? item.severity.toLowerCase().trim() : "warning";
			markers.push({
				startLineNumber: lineNumber,
				endLineNumber: lineNumber,
				startColumn: 1,
				endColumn: Math.max(100, lineText.length + 1),
				severity: getMarkerSeverity(monaco, item?.severity),
				message:
					typeof item?.message === "string" && item.message.trim().length > 0
						? item.message.trim()
						: "Issue detected on this line.",
			});

			const baseClassName =
				normalizedSeverity === "error"
					? "dash-issue-line-error"
					: normalizedSeverity === "suggestion"
						? "dash-issue-line-suggestion"
						: "dash-issue-line-warning";

			const className = lineNumber === activeIssueLine
				? `${baseClassName} dash-issue-line-active`
				: baseClassName;

			decorations.push({
				range: new monaco.Range(lineNumber, 1, lineNumber, Math.max(2, lineText.length + 1)),
				options: {
					isWholeLine: true,
					className,
				},
			});
		}

		const suggestionItems = Array.isArray(analysisResult?.suggestions) ? analysisResult.suggestions : [];
		for (const item of suggestionItems) {
			const lineNumber = toLineNumber(item?.line, maxLine);
			const lineText = lines[lineNumber - 1] || "";
			markers.push({
				startLineNumber: lineNumber,
				endLineNumber: lineNumber,
				startColumn: 1,
				endColumn: Math.max(100, lineText.length + 1),
				severity: getMarkerSeverity(monaco, "suggestion"),
				message:
					typeof item?.message === "string" && item.message.trim().length > 0
						? item.message.trim()
						: "Suggestion available for this line.",
			});

			const className = lineNumber === activeIssueLine
				? "dash-issue-line-suggestion dash-issue-line-active"
				: "dash-issue-line-suggestion";

			decorations.push({
				range: new monaco.Range(lineNumber, 1, lineNumber, Math.max(2, lineText.length + 1)),
				options: {
					isWholeLine: true,
					className,
				},
			});
		}

		monaco.editor.setModelMarkers(model, "analysis", markers);
		decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);
	}

	function handleEditorMount(editor, monaco) {
		editorRef.current = editor;
		monacoRef.current = monaco;
		applyAnalysisMarkers(code, analysis);
	}

	function handleEditorBeforeMount(monaco) {
		monaco.editor.defineTheme("vs-dark", {
			base: "vs-dark",
			inherit: true,
			rules: [
				{ token: "", foreground: "E6EDF3" },
			],
			colors: {
				"editor.background": "#0D1117",
				"editor.foreground": "#E6EDF3",
				"editorLineNumber.foreground": "#6E7681",
				"editorLineNumber.activeForeground": "#E6EDF3",
				"editorCursor.foreground": "#E6EDF3",
				"editor.selectionBackground": "#264F78",
				"editor.inactiveSelectionBackground": "#1F2A37",
			},
		});
	}

	async function handleFollowUpQuestion(e) {
		e.preventDefault();
		if (!currentQuestion.trim() || isQaLoading) {
			return;
		}

		setIsQaLoading(true);
		setQaError("");

		try {
			const token = localStorage.getItem("token");
			if (!token) {
				throw new Error("You must log in first to ask follow-up questions.");
			}

			const response = await fetch("/api/follow-up", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					code,
					issues: analysis.issues || [],
					suggestions: analysis.suggestions || [],
					refactoredCode: analysis.refactored_code || "",
					question: currentQuestion,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || "Failed to get answer.");
			}

			const data = await response.json();
			const newQa = {
				answer: data.answer || "",
				references: Array.isArray(data.references) ? data.references : [],
			};

			setLatestQa(newQa);

			setCurrentQuestion("");
		} catch (err) {
			setQaError(err.message || "Error processing your question.");
		} finally {
			setIsQaLoading(false);
		}
	}

	useEffect(() => {
		applyAnalysisMarkers(code, analysis);
	}, [code, analysis, activeIssueLine]);

	const complexityValue =
		typeof analysis.complexity === "string" && analysis.complexity.trim().length > 0
			? analysis.complexity
			: "N/A";
	const isComplexityHigh = complexityValue.includes("n^2") || complexityValue.includes("n2");
	const lineCount = code ? code.split(/\r?\n/).length : 1;
	const diffRows = buildDiffRows(code, analysis.refactored_code);

	return (
		<div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#1e293b_0%,#0f172a_40%,#020617_100%)] px-3 py-4 sm:px-6 lg:px-8">
			<div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-2xl">CodeLens AI</h1>
					<p className="mt-1 text-sm leading-6 text-slate-400">Understand. Fix. Improve your code with intelligent review.</p>
				</div>
				<div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-start lg:justify-end">
					<div className="inline-flex flex-wrap items-center rounded-lg border border-slate-700 bg-slate-900/90 p-1">
						<button
							type="button"
							onClick={() => setMode("review")}
							className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
								mode === "review"
									? "bg-blue-600 text-white"
									: "bg-transparent text-slate-300 hover:bg-slate-800"
							}`}
						>
							Review
						</button>
						<button
							type="button"
							onClick={() => setMode("learning")}
							className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
								mode === "learning"
									? "bg-blue-600 text-white"
									: "bg-transparent text-slate-300 hover:bg-slate-800"
							}`}
						>
							Learning
						</button>
					</div>
					<button
						type="button"
						className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70 sm:justify-start"
						onClick={handleAnalyze}
						disabled={isLoading}
					>
						{isLoading ? <Spinner /> : null}
						{isLoading ? "Analyzing..." : "Analyze Code"}
					</button>
					<button
						type="button"
						className="inline-flex items-center justify-center rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 sm:justify-start"
						onClick={handleLogout}
					>
						Logout
					</button>
				</div>
			</div>

			<div className="mx-auto mt-4 flex w-full max-w-7xl flex-col gap-4">
				<div className="grid w-full grid-cols-1 items-start gap-4 lg:h-[78vh] lg:grid-cols-12 lg:items-stretch lg:gap-6 lg:overflow-hidden">
				<section
					className={`relative flex min-h-[460px] flex-col overflow-hidden rounded-2xl p-px transition-all duration-300 lg:col-span-7 lg:h-full lg:min-h-0 ${
						isEditorFocused
							? "bg-[linear-gradient(135deg,rgba(56,189,248,0.9),rgba(59,130,246,0.35),rgba(139,92,246,0.45))] shadow-[0_0_0_1px_rgba(56,189,248,0.25),0_24px_70px_rgba(2,6,23,0.5),0_0_36px_rgba(56,189,248,0.18)]"
							: "bg-[linear-gradient(135deg,rgba(56,189,248,0.3),rgba(59,130,246,0.12),rgba(148,163,184,0.08))] shadow-[0_24px_70px_rgba(2,6,23,0.42)]"
					}`}
				>
					<div className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[15px] border border-slate-800/80 bg-slate-900/90 transition-all duration-300 ${isEditorFocused ? "ring-1 ring-sky-400/30" : ""}`}>
						<div className="flex flex-col gap-3 border-b border-slate-800/80 px-3 py-3 sm:px-4 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<span className="text-sm font-semibold uppercase tracking-wider text-slate-400">Editor</span>
								<p className="mt-1 text-sm leading-6 text-slate-500 sm:text-sm">Paste code, format it, and run an analysis from a real editor shell.</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-sm font-medium text-slate-300">
									{lineCount} line{lineCount === 1 ? "" : "s"}
								</span>
								<button
									type="button"
									className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
									onClick={handleClearCode}
								>
									Clear
								</button>
								<button
									type="button"
									className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
									onClick={handlePasteCode}
								>
									Paste
								</button>
								<button
									type="button"
									className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-sm font-semibold text-sky-200 transition hover:border-sky-400/50 hover:bg-sky-500/15"
									onClick={handleFormatCode}
								>
									Format
								</button>
							</div>
						</div>
						<div className="flex-1 min-h-[320px] overflow-auto bg-[#0D1117] dash-smooth-scroll sm:min-h-[420px] lg:min-h-[550px] lg:max-h-[650px]">
							<MonacoEditor
								height="100%"
								defaultLanguage="plaintext"
								value={code}
								onChange={(value) => setCode(value || "")}
								beforeMount={handleEditorBeforeMount}
								onMount={handleEditorMount}
								onFocus={() => setIsEditorFocused(true)}
								onBlur={() => setIsEditorFocused(false)}
								theme="vs-dark"
								options={{
									minimap: { enabled: false },
									fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
									fontLigatures: true,
									fontSize: 14,
									lineHeight: 22,
									hover: { enabled: true },
									renderValidationDecorations: "on",
									scrollBeyondLastLine: false,
									automaticLayout: true,
									wordWrap: "on",
									padding: { top: 14, bottom: 14 },
									renderLineHighlight: "all",
									cursorSmoothCaretAnimation: "on",
									smoothScrolling: true,
								}}
							/>
						</div>
						<div className="flex items-center justify-between gap-3 border-t border-slate-800/80 px-4 py-2 text-xs text-slate-500">
							<span>Tip: use Ctrl/Cmd + Enter to analyze after editing.</span>
							<span>{lineCount} line{lineCount === 1 ? "" : "s"} total</span>
						</div>
					</div>
				</section>

					<aside className="flex min-h-0 flex-col gap-4 overflow-hidden lg:col-span-5 lg:h-full lg:min-h-0">
					<div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-base font-semibold uppercase tracking-wider text-slate-300">Complexity</h2>
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
						<p className="text-sm leading-6 text-slate-400">
							Detected from structural analysis. Nested loops push complexity toward quadratic growth.
						</p>
					</div>

					{error ? (
						<div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm leading-6 text-rose-200">
							{error}
						</div>
					) : null}

					{!error && analysis?.degraded ? (
						<div className="rounded-2xl border border-amber-500/25 bg-amber-950/20 px-4 py-2 text-sm text-amber-200">
							Partial analysis (AI unavailable)
						</div>
					) : null}

					<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-visible lg:overflow-hidden">
						<div className="min-h-0 overflow-auto">
							<HighlightList
								title={mode === "learning" ? "Learning Hints" : "Issues"}
								items={analysis.issues}
								variant="issues"
								onItemClick={handleNavigateToIssue}
							/>
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							<HighlightList
								title={mode === "learning" ? "Guided Steps" : "Suggestions"}
								items={analysis.suggestions}
								variant="suggestions"
							/>
						</div>
					</div>
				</aside>
				</div>

				<div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
					<h3 className="mb-2 text-base font-semibold uppercase tracking-wider text-slate-300">Refactored Code</h3>
					{analysis.refactored_code ? (
						<>
							<div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<span className="text-xs text-slate-400">Compare changes before applying.</span>
								<button
									type="button"
									onClick={handleApplyFix}
									className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-500/20"
								>
									Apply Fix
								</button>
							</div>
							<div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
								<DiffPane title="Original" rows={diffRows} side="left" />
								<DiffPane title="Refactored" rows={diffRows} side="right" />
							</div>
							{fixMessage ? (
								<p className="mt-3 rounded-lg border border-emerald-500/35 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
									{fixMessage}
								</p>
							) : null}
						</>
					) : (
						<EmptyStateCard
							title="Refactored code"
							message="Refactored output will appear here after analysis."
							iconVariant="check"
						/>
					)}
				</div>

				<div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
					<h3 className="mb-3 text-base font-semibold uppercase tracking-wider text-slate-300">Follow-up Question</h3>
					<form onSubmit={handleFollowUpQuestion} className="flex flex-col gap-2 sm:flex-row">
						<input
							type="text"
							value={currentQuestion}
							onChange={(e) => setCurrentQuestion(e.target.value)}
							placeholder="Ask about this code..."
							disabled={isQaLoading || !code}
							className="flex-1 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-sky-500/50 focus:outline-none focus:ring-1 focus:ring-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
						/>
						<button
							type="submit"
							disabled={isQaLoading || !currentQuestion.trim() || !code}
							className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:border-sky-400/60 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:self-start"
						>
							{isQaLoading ? <Spinner /> : "Ask"}
						</button>
					</form>

					{qaError ? (
						<div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">
							{qaError}
						</div>
					) : null}

					{latestQa ? (
						<div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
							<p className="mb-2 text-sm font-semibold text-sky-300">Latest response</p>
							<p className="text-sm leading-6 text-slate-300">{latestQa.answer || "No answer returned."}</p>
							{latestQa.references && latestQa.references.length > 0 ? (
								<div className="mt-3 flex flex-wrap gap-2">
									{latestQa.references.map((ref, refIndex) => (
										<span
											key={refIndex}
											className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-xs text-slate-300"
										>
											Line {ref.line}: {ref.reason}
										</span>
									))}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

function DiffPane({ title, rows, side }) {
	return (
		<div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
			<div className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
				{title}
			</div>
			<div className="max-h-72 overflow-auto">
				{rows.map((row) => {
					const content = side === "left" ? row.left : row.right;
					let rowClass = "bg-transparent";

					if (row.type === "removed" && side === "left") {
						rowClass = "bg-rose-900/25";
					} else if (row.type === "added" && side === "right") {
						rowClass = "bg-emerald-900/25";
					} else if (row.type === "changed") {
						rowClass = side === "left" ? "bg-amber-900/20" : "bg-sky-900/20";
					}

					return (
						<div
							key={`${title}-${row.lineNumber}`}
							className={`grid grid-cols-[48px_minmax(0,1fr)] gap-2 border-b border-slate-900/80 px-2 py-1 text-xs leading-5 ${rowClass}`}
						>
							<span className="select-none text-right text-slate-500">{row.lineNumber}</span>
							<pre className="min-w-0 overflow-x-auto whitespace-pre text-slate-200">{content || " "}</pre>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function HighlightList({ title, items, variant, onItemClick }) {
	const isIssueVariant = variant === "issues";
	const displayItems = isIssueVariant
		? [...items].sort((a, b) => {
			const confA = typeof a?.confidence === "number" ? a.confidence : 0.5;
			const confB = typeof b?.confidence === "number" ? b.confidence : 0.5;
			return confB - confA;
		})
		: items;

	function getSeverityStyles(severity) {
		const normalized = typeof severity === "string" ? severity.toLowerCase().trim() : "warning";

		if (normalized === "error") {
			return {
				badge: "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/30",
				accent: "border-l-rose-500",
				label: "ERROR",
			};
		}

		if (normalized === "suggestion") {
			return {
				badge: "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30",
				accent: "border-l-sky-500",
				label: "SUGGESTION",
			};
		}

		return {
			badge: "bg-amber-500/15 text-amber-100 ring-1 ring-amber-500/30",
			accent: "border-l-amber-500",
			label: "WARNING",
		};
	}

	function getIssueExplanation(item) {
		if (typeof item?.explanation === "string" && item.explanation.trim()) {
			return item.explanation.trim();
		}

		return "This issue can cause runtime bugs or make future changes harder to maintain if left unresolved.";
	}

	function getCodeFix(item) {
		if (item?.fix && typeof item.fix === "object") {
			return {
				before: String(item.fix.before || "").trim(),
				after: String(item.fix.after || "").trim(),
			};
		}
		return { before: "", after: "" };
	}

	function getSuggestionSections(item) {
		const raw = String(item?.message ?? item ?? "").trim();
		if (!raw) {
			return {
				title: "Improve this section",
				why: "This helps readability and reduces maintenance risk.",
				fix: "Apply a concrete update on the referenced line.",
			};
		}

		const titleMatch = raw.match(/^Line\s+\d+\s*\([^)]*\):\s*(.*?)\./i);
		const whyMatch = raw.match(/This matters because\s*(.*?)\./i);
		const fixMatch = raw.match(/Concrete improvement:\s*(.*)$/i);

		const fallbackTitle = raw.split(".")[0]?.trim() || "Suggested improvement";

		return {
			title: titleMatch?.[1]?.trim() || fallbackTitle,
			why: whyMatch?.[1]?.trim() || "This change improves code quality and safety.",
			fix: fixMatch?.[1]?.trim() || raw,
		};
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl">
			<h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h3>
			<div className="flex-1 overflow-hidden">
				<div className={`h-full overflow-y-scroll overflow-x-hidden ${isIssueVariant ? "pr-1" : "pr-2"} dash-smooth-scroll`}>
					{displayItems.length > 0 ? (
						<ul className={isIssueVariant ? "space-y-3" : "space-y-4"}>
							{displayItems.map((item, index) => (
								<li
									key={`${title}-${index}`}
									className={`rounded-xl border border-slate-800 bg-slate-950/70 p-4 shadow-[0_10px_30px_rgba(2,6,23,0.28)] ${isIssueVariant ? "border-l-4 cursor-pointer transition hover:border-slate-600 hover:bg-slate-900/80" : "border-l-4 border-l-blue-500/60"}`}
									onClick={isIssueVariant ? () => onItemClick?.(item) : undefined}
								>
									{isIssueVariant ? (() => {
										const severityStyles = getSeverityStyles(item?.severity);
										const fix = getCodeFix(item);
										return (
											<div className="space-y-3">
												<div className="flex flex-wrap items-center gap-2">
													<span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wider ${severityStyles.badge}`}>
														{severityStyles.label}
													</span>
													<span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-slate-200 ring-1 ring-slate-700">
														LINE {renderSafe(item?.line) || "1"}
													</span>
													{typeof item?.confidence === "number" && (
														<span className="inline-flex items-center rounded-full bg-purple-900/40 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-purple-200 ring-1 ring-purple-700/50">
															{Math.round(item.confidence * 100)}% CONFIDENCE
														</span>
													)}
												</div>
												<p className="text-sm font-medium leading-6 text-slate-100">
													{renderSafe(item?.issue ?? item?.message ?? item)}
												</p>
												<div className="rounded-lg border border-slate-800/90 bg-slate-900/70 px-3 py-2">
													<p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Why it matters</p>
													<p className="mt-1 text-sm leading-6 text-slate-300">
														{getIssueExplanation(item)}
													</p>
												</div>
												{fix.before && fix.after ? (
													<div className="space-y-2">
														<div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2">
															<p className="text-[11px] font-semibold uppercase tracking-wider text-red-400">❌ Before</p>
															<pre className="mt-1 overflow-x-auto text-xs leading-5 text-red-200 font-mono">
																<code>{renderSafe(fix.before)}</code>
															</pre>
														</div>
														<div className="rounded-lg border border-green-900/50 bg-green-950/30 px-3 py-2">
															<p className="text-[11px] font-semibold uppercase tracking-wider text-green-400">✅ After</p>
															<pre className="mt-1 overflow-x-auto text-xs leading-5 text-green-200 font-mono">
																<code>{renderSafe(fix.after)}</code>
															</pre>
														</div>
													</div>
												) : null}
											</div>
										);
									})() : (() => {
										const suggestion = getSuggestionSections(item);
										const line = renderSafe(item?.relatedLine ?? item?.line) || "1";
										return (
											<div className="flex flex-col gap-3">
												<div className="flex items-center gap-2">
													<p className="font-semibold text-white leading-6">{suggestion.title}</p>
													<span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-slate-200 ring-1 ring-slate-700">
														Line {line}
													</span>
												</div>
												<p className="text-sm text-gray-400 leading-6">{suggestion.why}</p>
												<div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
													<p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Fix</p>
													<pre className="mt-1 overflow-x-auto font-mono text-xs leading-5 text-slate-200">
														<code>{suggestion.fix}</code>
													</pre>
												</div>
											</div>
										);
									})()}
								</li>
							))}
						</ul>
					) : (
						<EmptyStateCard
							title={isIssueVariant ? "Clean result" : "Nothing to add"}
							message={
								isIssueVariant
									? "No issues found. Your code is holding up well here."
									: "No suggestions needed right now. The analyzer did not find any obvious improvements."
							}
							iconVariant={isIssueVariant ? "check" : "spark"}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function EmptyStateCard({ title, message, iconVariant }) {
	return (
		<div className="rounded-xl border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.82)_0%,rgba(11,15,23,0.96)_100%)] p-4">
			<div className="flex items-start gap-3">
				<div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${iconVariant === "check" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-sky-400/30 bg-sky-500/10 text-sky-200"}`}>
					{iconVariant === "check" ? <CheckCircleIcon /> : <SparkIcon />}
				</div>
				<div className="min-w-0">
					<p className="text-sm font-semibold text-slate-100">{title}</p>
					<p className="mt-1 text-sm leading-6 text-slate-400">{message}</p>
				</div>
			</div>
		</div>
	);
}

function CheckCircleIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
			<path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" stroke="currentColor" strokeWidth="1.8" />
			<path d="m8.5 12.2 2.1 2.1 4.8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function SparkIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
			<path d="M12 3.5 13.7 8l4.5 1.7-4.5 1.7L12 15.9l-1.7-4.5L5.8 9.7 10.3 8 12 3.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
			<path d="M18.5 14.5 19.3 16.8 21.5 17.6 19.3 18.4 18.5 20.7 17.7 18.4 15.5 17.6 17.7 16.8 18.5 14.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
		</svg>
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
