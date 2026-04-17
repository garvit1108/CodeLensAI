export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.setHeader("Allow", ["POST"]);
		return res.status(405).json({ error: "Method not allowed" });
	}

	const authHeader = req.headers.authorization || "";
	const { code = "", mode = "review" } = req.body || {};
	const normalizedMode = mode === "learning" ? "learning" : "review";

	if (typeof code !== "string" || !code.trim()) {
		return res.status(400).json({ error: "Code is required" });
	}

	try {
		const upstream = await fetch("http://localhost:5000/api/analyze", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(authHeader ? { Authorization: authHeader } : {}),
			},
			body: JSON.stringify({
				code,
				mode: normalizedMode,
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
		console.error("Analyze proxy error:", error);
		return res.status(502).json({ error: "Failed to reach analysis server" });
	}
}
