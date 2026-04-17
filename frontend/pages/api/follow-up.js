export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.setHeader("Allow", ["POST"]);
		return res.status(405).json({ error: "Method not allowed" });
	}

	const { code = "", issues = [], suggestions = [], refactoredCode = "", question = "" } = req.body || {};

	if (typeof code !== "string" || !code.trim()) {
		return res.status(400).json({ error: "Code is required" });
	}

	if (typeof question !== "string" || !question.trim()) {
		return res.status(400).json({ error: "Question is required" });
	}

	if (!Array.isArray(issues)) {
		return res.status(400).json({ error: "Issues must be an array" });
	}

	if (!Array.isArray(suggestions)) {
		return res.status(400).json({ error: "Suggestions must be an array" });
	}

	if (refactoredCode !== undefined && typeof refactoredCode !== "string") {
		return res.status(400).json({ error: "Refactored code must be a string" });
	}

	try {
		const authHeader = req.headers.authorization || "";
		const upstream = await fetch("http://localhost:5000/api/follow-up", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(authHeader ? { Authorization: authHeader } : {}),
			},
			body: JSON.stringify({
				code,
				issues,
				suggestions,
				refactoredCode: refactoredCode || "",
				question,
			}),
		});

		const raw = await upstream.text();
		let data;
		try {
			data = raw ? JSON.parse(raw) : {};
		} catch {
			data = { error: raw || "Invalid upstream response" };
		}

		return res.status(upstream.status).json(data);
	} catch (error) {
		console.error("Follow-up proxy error:", error);
		return res.status(500).json({
			error: "Failed to process follow-up question",
		});
	}
}
