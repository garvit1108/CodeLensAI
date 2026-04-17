import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { getToken, removeToken } from "../utils/auth";
import ProtectedRoute from "../components/ProtectedRoute";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export default function DashboardPage() {
	const renderSafe = (val) => {
		if (val === null || val === undefined) return "";
		if (typeof val === "string" || typeof val === "number") return val;
		return JSON.stringify(val);
	};

	const router = useRouter();
	const [code, setCode] = useState("function sum(a, b) {\n  return a + b;\n}");
	const [mode, setMode] = useState("review");
	const [result, setResult] = useState(null);
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [error, setError] = useState("");
	const [copyMessage, setCopyMessage] = useState("");
	const [hintStepProgress, setHintStepProgress] = useState({});
	const [isEditorFocused, setIsEditorFocused] = useState(false);
	const editorRef = useRef(null);
	const monacoRef = useRef(null);
	const decorationIdsRef = useRef([]);

	async function handleAnalyze() {
		if (isAnalyzing) {
			return;
		}

		if (!code.trim()) {
			setError("Please enter code before analyzing.");
			return;
		}

		const selectedMode = mode === "learning" ? "learning" : "review";
		const token = getToken();

		if (!token) {
			setError("Please log in to analyze code.");
			router.push("/login");
			return;
		}

		setIsAnalyzing(true);
		setResult(null);
		setError("");
		setCopyMessage("");
		setHintStepProgress({});

		try {
			const response = await fetch("/api/analyze", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					code,
					mode: selectedMode,
				}),
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
					router.push("/login");
					return;
				}

				if (response.status >= 500) {
					throw new Error("Server error while analyzing code. Please try again.");
				}

				throw new Error(apiError || "Failed to analyze code.");
			}

			const data = await response.json();
			setResult(data);
			setCopyMessage("");
			setHintStepProgress({});
		} catch (err) {
			console.error(err);
			setError("Analysis failed");
		} finally {
			setIsAnalyzing(false);
		}
	}

	async function handleLogout() {
		removeToken();
		router.push("/login");
	}

	function getMarkerSeverity(monaco, severity) {
		const normalized = typeof severity === "string" ? severity.toLowerCase().trim() : "warning";
		if (normalized === "error") return monaco.MarkerSeverity.Error;
		if (normalized === "suggestion") return monaco.MarkerSeverity.Info;
		return monaco.MarkerSeverity.Warning;
	}

	function buildAnalysisMarkers(monaco, sourceCode, analysisResult) {
		const lines = String(sourceCode || "").split(/\r?\n/);
		const maxLine = Math.max(1, lines.length);
		const markers = [];

		function toValidLine(rawLine) {
			const num = Number(rawLine);
			if (!Number.isFinite(num)) return null;
			const line = Math.floor(num);
			if (line < 1 || line > maxLine) return null;
			return line;
		}

		const issueItems = Array.isArray(analysisResult?.issues) ? analysisResult.issues : [];
		for (const item of issueItems) {
			const line = toValidLine(item?.line);
			if (!line) continue;
			const lineText = lines[line - 1] || "";
			const endColumn = Math.max(100, lineText.length + 1);
			const message =
				typeof item?.message === "string" && item.message.trim()
					? item.message.trim()
					: "Issue detected on this line.";

			markers.push({
				startLineNumber: line,
				endLineNumber: line,
				startColumn: 1,
				endColumn,
				message,
				severity: getMarkerSeverity(monaco, item?.severity),
			});
		}

		const suggestionItems = Array.isArray(analysisResult?.suggestions) ? analysisResult.suggestions : [];
		for (const item of suggestionItems) {
			const line = toValidLine(item?.line);
			if (!line) continue;
			const lineText = lines[line - 1] || "";
			const endColumn = Math.max(100, lineText.length + 1);
			const message =
				typeof item?.message === "string" && item.message.trim()
					? item.message.trim()
					: "Suggestion available for this line.";

			markers.push({
				startLineNumber: line,
				endLineNumber: line,
				startColumn: 1,
				endColumn,
				message,
				severity: getMarkerSeverity(monaco, "suggestion"),
			});
		}

		return markers;
	}

	function buildIssueDecorations(monaco, sourceCode, analysisResult) {
		const lines = String(sourceCode || "").split(/\r?\n/);
		const maxLine = Math.max(1, lines.length);
		const decorations = [];

		function toValidLine(rawLine) {
			const num = Number(rawLine);
			if (!Number.isFinite(num)) return null;
			const line = Math.floor(num);
			if (line < 1 || line > maxLine) return null;
			return line;
		}

		const issueItems = Array.isArray(analysisResult?.issues) ? analysisResult.issues : [];
		for (const item of issueItems) {
			const line = toValidLine(item?.line);
			if (!line) continue;
			const lineText = lines[line - 1] || "";
			const severity = typeof item?.severity === "string" ? item.severity.toLowerCase().trim() : "warning";
			const className = severity === "error" ? "dash-issue-line-error" : severity === "suggestion" ? "dash-issue-line-suggestion" : "dash-issue-line-warning";

			decorations.push({
				range: new monaco.Range(line, 1, line, Math.max(100, lineText.length + 1)),
				options: {
					isWholeLine: true,
					className,
					inlineClassName: className,
				},
			});
		}

		return decorations;
	}

	function applyAnalysisMarkers(sourceCode, analysisResult) {
		const editor = editorRef.current;
		const monaco = monacoRef.current;
		if (!editor || !monaco) return;

		const model = editor.getModel();
		if (!model) return;

		const isReviewResult = (analysisResult?.mode || mode) === "review";
		if (!analysisResult || !isReviewResult) {
			monaco.editor.setModelMarkers(model, "codelens-ai", []);
			return;
		}

		const markers = buildAnalysisMarkers(monaco, sourceCode, analysisResult);
		monaco.editor.setModelMarkers(model, "codelens-ai", markers);
		decorationIdsRef.current = editor.deltaDecorations(
			decorationIdsRef.current,
			buildIssueDecorations(monaco, sourceCode, analysisResult)
		);
	}

	function handleEditorDidMount(editor, monaco) {
		editorRef.current = editor;
		monacoRef.current = monaco;
		applyAnalysisMarkers(code, result);
	}

	function handleEditorBeforeMount(monaco) {
		monaco.editor.defineTheme("vs-dark", {
			base: "vs-dark",
			inherit: true,
			rules: [{ token: "", foreground: "E6EDF3" }],
			colors: {
				"editor.background": "#0D1117",
				"editor.foreground": "#E6EDF3",
				"editor.lineHighlightBackground": "#1F2937AA",
			},
		});
	}

	useEffect(() => {
		applyAnalysisMarkers(code, result);
	}, [code, result, mode]);

	function handleClearCode() {
		setCode("");
	}

	async function handlePasteCode() {
		try {
			const clipboardText = await navigator.clipboard.readText();
			if (typeof clipboardText === "string") {
				setCode(clipboardText);
			}
		} catch {
			setError("Could not access clipboard. Please paste manually.");
		}
	}

	async function handleCopyReport() {
		if (!result) {
			return;
		}

		if (isLearningModeActive) {
			const formattedHints = hints.length
				? hints
						.map((hint, index) => {
							const line = typeof hint?.line === "number" ? hint.line : "N/A";
							return [
								`${index + 1}. Line ${line}`,
								`  Step 1: ${safe(hint?.step1)}`,
								`  Step 2: ${safe(hint?.step2)}`,
								`  Step 3: ${safe(hint?.step3)}`,
							].join("\n");
						})
						.join("\n\n")
				: "None";

			const learningReport = [
				"CodeLens AI Report",
				"======================",
				"",
				"Mode: Learning",
				`Score: ${scoreValue ?? "N/A"}`,
				"",
				"Hints:",
				formattedHints,
			].join("\n");

			await navigator.clipboard.writeText(learningReport);
			setCopyMessage("Report copied to clipboard.");
			return;
		}

		const formattedIssues = issues.length
			? issues
					.map((item, index) => {
						const line = typeof item?.line === "number" ? item.line : "N/A";
						const message =
							typeof item === "string"
								? safe(item)
								: typeof item?.message === "string"
									? safe(item.message)
									: safe(item?.message || item?.problem || "Issue");
						const severity = typeof item?.severity === "string" ? item.severity : "warning";
						return `${index + 1}. [${severity.toUpperCase()}] Line ${line}: ${message}`;
					})
					.join("\n")
			: "None";

		const formattedSuggestions = suggestions.length
			? suggestions
					.map((item, index) => {
						const line = typeof item?.line === "number" ? item.line : "N/A";
						const message =
							typeof item === "string"
								? safe(item)
								: typeof item?.message === "string"
									? safe(item.message)
									: safe(item?.message || "Suggestion");
						return `${index + 1}. Line ${line}: ${message}`;
					})
					.join("\n")
			: "None";

		const report = [
			"CodeLens AI Report",
			"======================",
			"",
			"Mode: Review",
			`Score: ${scoreValue ?? "N/A"}`,
			"",
			"Issues:",
			formattedIssues,
			"",
			"Suggestions:",
			formattedSuggestions,
		].join("\n");

		await navigator.clipboard.writeText(report);
		setCopyMessage("Report copied to clipboard.");
	}

	const scoreValue =
		typeof result?.score === "number"
			? result.score
			: null;

	const issues = Array.isArray(result?.issues) ? result.issues : [];
	const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
	const hints = Array.isArray(result?.hints) ? result.hints : [];
	const refactoredCode = typeof result?.refactoredCode === "string" ? result.refactoredCode : "";
	const isLearningModeActive = (result?.mode || mode) === "learning";
	const normalizedScore = typeof scoreValue === "number" ? Math.max(0, Math.min(100, scoreValue)) : 0;
	const scoreStyles = getScoreStyles(scoreValue);
	const scoreRingStyle = {
		background: `conic-gradient(${scoreStyles.ring} ${normalizedScore * 3.6}deg, rgba(71,85,105,0.35) 0deg)`,
	};

	function detectEditorLanguage(source) {
		const codeSample = typeof source === "string" ? source : "";
		if (!codeSample.trim()) {
			return "javascript";
		}

		if (/^\s*#include\s*<|\bstd::|\bcout\s*<</m.test(codeSample)) return "cpp";
		if (/^\s*using\s+[A-Z][\w.]*\s*;|\bnamespace\s+[A-Z][\w.]*/m.test(codeSample)) return "csharp";
		if (/^\s*package\s+main\b|\bfunc\s+[A-Za-z_]\w*\s*\(/m.test(codeSample)) return "go";
		if (/^\s*import\s+\w+|\bdef\s+\w+\s*\(|:\s*(\n|#)/m.test(codeSample)) return "python";
		if (/\bpublic\s+class\b|\bSystem\.out\.println\s*\(/m.test(codeSample)) return "java";
		if (/\binterface\s+[A-Z]\w*|\btype\s+[A-Z]\w*\s*=|:\s*[A-Za-z_$][\w$<>,\[\]\s|&]*/m.test(codeSample)) return "typescript";
		if (/^\s*\{[\s\S]*\}\s*$/m.test(codeSample)) return "json";

		return "javascript";
	}

	const editorLanguage = detectEditorLanguage(code);

	const safe = (v) =>
		typeof v === "string" || typeof v === "number"
			? v
			: JSON.stringify(v ?? "");

	function getVisibleHintSteps(index) {
		return hintStepProgress[index] || 1;
	}

	function handleShowNextHint(index) {
		setHintStepProgress((prev) => {
			const current = prev[index] || 1;
			if (current >= 3) {
				return prev;
			}

			return {
				...prev,
				[index]: current + 1,
			};
		});
	}

	function getIssueStyles(severity) {
		if (severity === "error") {
			return {
				border: "border-[#EF4444]/40",
				badge: "bg-[#EF4444]/15 text-[#FCA5A5] ring-[#EF4444]/30",
				left: "border-l-[#EF4444]",
				icon: "text-[#FCA5A5]",
			};
		}

		if (severity === "suggestion") {
			return {
				border: "border-[#3B82F6]/40",
				badge: "bg-[#3B82F6]/15 text-[#BFDBFE] ring-[#3B82F6]/30",
				left: "border-l-[#3B82F6]",
				icon: "text-[#BFDBFE]",
			};
		}

		return {
			border: "border-[#FACC15]/40",
			badge: "bg-[#FACC15]/15 text-[#FEF08A] ring-[#FACC15]/30",
			left: "border-l-[#FACC15]",
			icon: "text-[#FEF08A]",
		};
	}

	function getScoreStyles(value) {
		if (typeof value !== "number") {
			return {
				text: "text-slate-200",
				ring: "#64748B",
				label: "Awaiting Score",
			};
		}

		if (value >= 75) {
			return {
				text: "text-[#22C55E]",
				ring: "#22C55E",
				label: "Strong",
			};
		}

		if (value >= 45) {
			return {
				text: "text-[#FACC15]",
				ring: "#FACC15",
				label: "Needs Work",
			};
		}

		return {
			text: "text-[#EF4444]",
			ring: "#EF4444",
			label: "High Risk",
		};
	}

	function IssueSeverityIcon({ severity }) {
		if (severity === "error") {
			return (
				<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
					<path d="M12 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
					<path d="M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					<path d="M10 3.5 2.8 16a2 2 0 0 0 1.73 3h14.94A2 2 0 0 0 21.2 16L14 3.5a2 2 0 0 0-3.46 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
				</svg>
			);
		}

		if (severity === "warning") {
			return (
				<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
					<path d="M12 8v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
					<path d="M12 15.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					<path d="M10.2 4.2 2.4 18a1.9 1.9 0 0 0 1.66 2.8h16a1.9 1.9 0 0 0 1.66-2.8l-7.8-13.8a1.9 1.9 0 0 0-3.32 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
				</svg>
			);
		}

		if (severity === "suggestion") {
			return (
				<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
					<circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
					<path d="M12 10.2v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
					<path d="M12 7.7h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
				</svg>
			);
		}

		return (
			<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
				<path d="M12 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				<path d="M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
				<circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
			</svg>
		);
	}

	function HintCardIcon() {
		return (
			<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
				<path d="M9 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				<path d="M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				<path d="M9.5 14.5A5.5 5.5 0 1 1 14.5 14.5c-.8.7-1.5 1.7-1.8 2.5h-3.4c-.3-.8-1-1.8-1.8-2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
			</svg>
		);
	}

	function CodeIcon({ active }) {
		return (
			<svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 transition-transform duration-300 ${active ? "scale-110" : ""}`} aria-hidden="true">
				<path d="M8 9L4 12l4 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M16 9l4 3-4 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M14 7l-4 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}

	function EmptyStateMessage({ title, message, iconVariant }) {
		return (
			<div className="rounded-xl border border-[#2A3441] bg-[linear-gradient(180deg,rgba(15,23,42,0.82)_0%,rgba(11,15,23,0.96)_100%)] p-4">
				<div className="flex items-start gap-3">
					<div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${iconVariant === "check" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : iconVariant === "spark" ? "border-sky-400/30 bg-sky-500/10 text-sky-200" : "border-slate-600 bg-slate-950 text-slate-200"}`}>
						{iconVariant === "check" ? <CheckCircleIcon /> : iconVariant === "spark" ? <SparkIcon /> : <DocumentIcon />}
					</div>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-slate-100">{safe(title)}</p>
						<p className="mt-1 text-sm leading-6 text-slate-400">{safe(message)}</p>
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

	function DocumentIcon() {
		return (
			<svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
				<path d="M7 3.8h6.5L17.8 8v12.2A1.8 1.8 0 0 1 16 22H7a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M13.5 3.8V8H17.8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M8.5 12.5h6M8.5 15.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			</svg>
		);
	}

	const buttonMotion = "transform-gpu transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]";
	const primaryButtonClass = `rounded-lg bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 py-2 text-sm font-medium text-white shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_10px_24px_rgba(59,130,246,0.18)] hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(59,130,246,0.22),0_14px_30px_rgba(59,130,246,0.24)] ${buttonMotion}`;
	const secondaryButtonClass = `rounded-lg border border-[#2A3441] bg-[#0B0F17] px-4 py-2 text-sm font-medium text-slate-200 hover:border-[#3B82F6]/40 hover:bg-[#1A2332] hover:text-white ${buttonMotion}`;
	const cardBaseClass = "rounded-xl border border-[#2A3441]/85 bg-[linear-gradient(155deg,rgba(26,35,50,0.78)_0%,rgba(17,24,39,0.94)_58%,rgba(11,15,23,0.98)_100%)] backdrop-blur-sm shadow-[0_14px_42px_rgba(2,6,23,0.42)]";
	const cardHoverClass = "dash-mode-transition transform-gpu transition-all duration-300 hover:-translate-y-0.5 hover:border-[#3B82F6]/38 hover:shadow-[0_18px_44px_rgba(2,6,23,0.5),0_0_0_1px_rgba(59,130,246,0.12)]";
	const activeCardGlowClass = "border-[#3B82F6]/45 shadow-[0_18px_44px_rgba(2,6,23,0.52),0_0_0_1px_rgba(59,130,246,0.2),0_0_28px_rgba(59,130,246,0.1)]";
	const sectionTagClass = "inline-flex items-center rounded-full border border-[#334155] bg-[#0B0F17]/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300";
	const analysis = result;
	const editorContainerStyle = {
		width: "100%",
		maxWidth: "none",
		height: "100%",
		borderRadius: "12px",
		overflow: "hidden",
		background: "linear-gradient(180deg,#0A0F17_0%,#0D1117_100%)",
		border: isEditorFocused
			? "1px solid rgba(59,130,246,0.88)"
			: "1px solid rgba(71,85,105,0.85)",
		boxShadow: isEditorFocused
			? "0 0 0 1px rgba(59,130,246,0.36), 0 20px 52px rgba(2,6,23,0.72), 0 0 26px rgba(59,130,246,0.2)"
			: "0 16px 40px rgba(2,6,23,0.64)",
		transform: isEditorFocused ? "translateY(-1px)" : "none",
		transition: "border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease",
	};

	return (
		<ProtectedRoute>
			<div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#111827_0%,#020617_58%,#020617_100%)] text-white">
				<header className="shrink-0 border-b border-slate-800/80 bg-slate-950/80 px-4 py-4 backdrop-blur-sm sm:px-6 lg:px-8">
					<div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
						<div>
							<h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard Debug View</h2>
							<p className="mt-1 text-sm text-slate-400">Analyze code, review issues, and compare refactors without leaving the editor.</p>
						</div>
						<div className="flex items-center gap-3 text-xs text-slate-400">
							<span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1">Mode: {renderSafe(mode)}</span>
						</div>
					</div>
				</header>

				<main className="flex-1 px-4 py-4 sm:px-6 lg:px-8">
					<div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
						<div className="mb-8 grid h-[70vh] grid-cols-[2.5fr_1fr] gap-6">
						<section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/70 shadow-[0_24px_70px_rgba(2,6,23,0.58)]">
							<div className="shrink-0 border-b border-slate-800/80 px-4 py-4 sm:px-5">
								<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
									<div>
										<label htmlFor="debug-code" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Code</label>
										<p className="mt-1 text-sm text-slate-500">Editor stays fixed height and scrolls independently.</p>
									</div>
									<div className="flex items-center gap-2">
										<button type="button" onClick={handleAnalyze} disabled={isAnalyzing} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70">
											{isAnalyzing ? "Analyzing..." : "Analyze"}
										</button>
									</div>
								</div>
							</div>

							<div className="flex-1 min-h-0 overflow-hidden p-4 sm:p-5">
								<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800/80 bg-[linear-gradient(180deg,#0A0F17_0%,#0D1117_100%)]">
									<div className="shrink-0 border-b border-slate-800/70 px-4 py-3 text-xs text-slate-500">
										<p>Editor fills the available height and scrolls independently from the analysis panel.</p>
									</div>
									<div className="flex-1 overflow-auto dash-smooth-scroll">
										<div style={editorContainerStyle} className="flex h-full min-h-[340px] w-full flex-col rounded-none border-0 shadow-none">
											<MonacoEditor
												height="100%"
												language={editorLanguage}
												value={code}
												onChange={(value) => setCode(value || "")}
												onFocus={() => setIsEditorFocused(true)}
												onBlur={() => setIsEditorFocused(false)}
												beforeMount={handleEditorBeforeMount}
												onMount={handleEditorDidMount}
												theme="vs-dark"
												options={{
													minimap: { enabled: false },
													hover: { enabled: true },
													fontSize: 14,
													lineHeight: 22,
													padding: { top: 12, bottom: 12 },
													scrollBeyondLastLine: false,
													automaticLayout: true,
													wordWrap: "on",
													smoothScrolling: true,
												}}
											/>
										</div>
									</div>
								</div>
							</div>
						</section>

						<aside className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
							<div className="shrink-0 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-4 shadow-[0_20px_50px_rgba(2,6,23,0.42)]">
								<p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Status</p>
								<div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-300">
									<div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">Score: {renderSafe(scoreValue ?? "N/A")}</div>
									<div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">Language: {renderSafe(editorLanguage)}</div>
								</div>
								{error ? <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{renderSafe(error)}</p> : null}
							</div>

							<div className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/70 shadow-[0_20px_50px_rgba(2,6,23,0.42)]">
								<div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4">
									<AnalysisCard title="Issues" count={issues.length} tone="error">
										<div className="flex-1 min-h-[180px] max-h-full overflow-auto pr-1 dash-smooth-scroll">
											{issues.length > 0 ? issues.map((item, i) => (
												<div key={i} className="mb-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 last:mb-0">
													<div className="flex flex-wrap items-center gap-2">
														<span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-rose-200 ring-1 ring-rose-500/30">{String(item?.severity || "warning").toUpperCase()}</span>
														<span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-slate-200 ring-1 ring-slate-700">Line {renderSafe(item?.line)}</span>
													</div>
													<p className="mt-3 text-sm font-medium leading-6 text-slate-100">{renderSafe(item?.message ?? item)}</p>
													<p className="mt-3 text-sm leading-6 text-slate-300"><span className="font-semibold text-slate-200">Why it matters:</span> {renderSafe(item?.explanation || "This issue can lead to runtime failures or incorrect behavior if not fixed.")}</p>
												</div>
											)) : <EmptyStateMessage title="No issues yet" message="Run analysis to populate issue cards here." iconVariant="check" />}
										</div>
									</AnalysisCard>

									<AnalysisCard title="Suggestions" count={suggestions.length} tone="suggestion">
										<div className="flex-1 min-h-[180px] max-h-full overflow-auto pr-1 dash-smooth-scroll">
											{suggestions.length > 0 ? suggestions.map((item, i) => (
												<div key={i} className="mb-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 last:mb-0">
													<p className="text-sm font-medium leading-6 text-slate-100">{renderSafe(item?.message ?? item)}</p>
												</div>
											)) : <EmptyStateMessage title="No suggestions yet" message="Suggestions will appear here after analysis." iconVariant="spark" />}
										</div>
									</AnalysisCard>
								</div>
							</div>
						</aside>
					</div>

					<div className="mt-8 border-t border-gray-700 pt-6">
						<section className="shrink-0 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/70 shadow-[0_20px_50px_rgba(2,6,23,0.42)]">
							<div className="flex items-center justify-between gap-4 border-b border-slate-800/80 px-4 py-4 sm:px-5">
								<div>
									<h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">Refactored Code</h3>
									<p className="mt-1 text-sm text-slate-500">Full-width refactor area sits below the editor and analysis panels.</p>
								</div>
								<div className="flex items-center gap-2">
									{refactoredCode ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-200">Ready</span> : null}
								</div>
							</div>
							<div className="max-h-[260px] overflow-auto p-4 dash-smooth-scroll">
								{refactoredCode ? (
									<pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs leading-6 text-slate-200">{refactoredCode}</pre>
								) : (
									<EmptyStateMessage title="No refactor yet" message="The refactored version will appear here after analysis." iconVariant="spark" />
								)}
							</div>
						</section>
					</div>
					</div>
				</main>
			</div>
		</ProtectedRoute>
	);
}

function AnalysisCard({ title, count, tone, children }) {
	const toneStyles =
		tone === "error"
			? "border-rose-500/20 bg-rose-500/5 text-rose-200"
			: tone === "suggestion"
				? "border-sky-500/20 bg-sky-500/5 text-sky-200"
				: "border-slate-700 bg-slate-900/60 text-slate-200";

	return (
		<section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4 shadow-[0_12px_36px_rgba(2,6,23,0.35)]">
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">{title}</h3>
				<span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ring-1 ${toneStyles}`}>{count}</span>
			</div>
			{children}
		</section>
	);
}
