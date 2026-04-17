const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

function generateToken(userId) {
	const secret = process.env.JWT_SECRET;
	if (!secret) {
		throw new Error("JWT_SECRET is not configured");
	}

	return jwt.sign({ id: userId }, secret, { expiresIn: "7d" });
}

function buildUserResponse(user) {
	return {
		id: user._id,
		name: user.name,
		email: user.email,
	};
}

async function signup(req, res) {
	try {
		const { name, email, password } = req.body || {};

		// Validate all fields are provided
		if (!name || !email || !password) {
			return res.status(400).json({ error: "Name, email, and password are required" });
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			return res.status(400).json({ error: "Invalid email format" });
		}

		// Validate password minimum length
		if (password.length < 6) {
			return res.status(400).json({ error: "Password must be at least 6 characters long" });
		}

		// Check if user already exists
		const existingUser = await User.findOne({ email });
		if (existingUser) {
			return res.status(409).json({ error: "Email already registered" });
		}

		// Hash password and create user
		const hashedPassword = await bcrypt.hash(password, 10);
		const user = await User.create({
			name,
			email,
			password: hashedPassword,
		});

		// Generate token and return response
		const token = generateToken(user._id.toString());

		return res.status(201).json({
			success: true,
			message: "User created successfully",
			token,
			user: buildUserResponse(user),
		});
	} catch (error) {
		console.error("Signup error:", error.message || error);
		return res.status(500).json({ error: "Internal server error" });
	}
}

async function login(req, res) {
	try {
		const { email, password } = req.body || {};

		if (!email || !password) {
			return res.status(400).json({ error: "Email and password are required" });
		}

		const user = await User.findOne({ email });
		if (!user) {
			return res.status(401).json({ error: "Invalid email or password" });
		}

		const isPasswordValid = await bcrypt.compare(password, user.password);
		if (!isPasswordValid) {
			return res.status(401).json({ error: "Invalid email or password" });
		}

		const token = generateToken(user._id.toString());

		return res.status(200).json({
			success: true,
			message: "Login successful",
			token,
			user: buildUserResponse(user),
		});
	} catch (error) {
		console.error("Login error:", error.message || error);
		return res.status(500).json({ error: "Internal server error" });
	}
}

module.exports = {
	signup,
	login,
};
