import Router from "next/router";
import { removeToken } from "./auth";

/**
 * Makes an authenticated API request with JWT token
 * Automatically handles 401 responses by clearing token and redirecting to login
 *
 * @param {string} url - API endpoint URL
 * @param {object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Response>} - Fetch response
 */
export async function fetchWithAuth(url, options = {}) {
	const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

	// Build headers with JWT token
	const headers = {
		"Content-Type": "application/json",
		...(options.headers || {}),
	};

	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const response = await fetch(url, {
		...options,
		headers,
	});

	// Handle unauthorized access
	if (response.status === 401) {
		removeToken();
		// Redirect to login (only in browser)
		if (typeof window !== "undefined") {
			Router.replace("/login");
		}
	}

	return response;
}

/**
 * Makes a simple non-authenticated API request
 * Useful for login, signup, and public endpoints
 *
 * @param {string} url - API endpoint URL
 * @param {object} options - Fetch options
 * @returns {Promise<Response>} - Fetch response
 */
export async function fetchAPI(url, options = {}) {
	const headers = {
		"Content-Type": "application/json",
		...(options.headers || {}),
	};

	return fetch(url, {
		...options,
		headers,
	});
}
