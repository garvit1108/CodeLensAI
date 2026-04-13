const jwt = require("jsonwebtoken");

function protect(req, res, next) {
	try {
		const authHeader = req.headers.authorization || "";

		if (!authHeader.startsWith("Bearer ")) {
			return res.status(401).json({ error: "Not authorized, no token" });
		}

		const token = authHeader.split(" ")[1];
		if (!token) {
			return res.status(401).json({ error: "Not authorized, no token" });
		}

		const secret = process.env.JWT_SECRET;
		if (!secret) {
			return res.status(401).json({ error: "Not authorized, invalid token" });
		}

		const decoded = jwt.verify(token, secret);
		req.user = { id: decoded.id };

		return next();
	} catch (error) {
		return res.status(401).json({ error: "Not authorized, invalid token" });
	}
}

module.exports = {
	protect,
};
