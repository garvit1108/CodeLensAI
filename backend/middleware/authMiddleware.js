const jwt = require("jsonwebtoken");

function protect(req, res, next) {
	try {
		const authHeader = req.headers.authorization || "";

		// Check Authorization header format
		if (!authHeader.startsWith("Bearer ")) {
			return res.status(401).json({ error: "No token provided" });
		}

		const token = authHeader.split(" ")[1];
		if (!token) {
			return res.status(401).json({ error: "No token provided" });
		}

		// Verify JWT_SECRET is configured
		const secret = process.env.JWT_SECRET;
		if (!secret) {
			console.error("JWT_SECRET is not configured");
			return res.status(401).json({ error: "Invalid token" });
		}

		// Verify token
		const decoded = jwt.verify(token, secret);
		req.user = { id: decoded.id };

		return next();
	} catch (error) {
		// Handle specific JWT errors
		if (error.name === "TokenExpiredError") {
			return res.status(401).json({ error: "Token expired" });
		}

		if (error.name === "JsonWebTokenError") {
			return res.status(401).json({ error: "Invalid token" });
		}

		// Generic unhandled errors
		console.error("Auth middleware error:", error.message || error);
		return res.status(401).json({ error: "Invalid token" });
	}
}

module.exports = {
	protect,
};
