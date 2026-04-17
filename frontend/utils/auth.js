function isBrowser() {
	return typeof window !== "undefined";
}

function getToken() {
	if (!isBrowser()) {
		return null;
	}

	return localStorage.getItem("token");
}

function setToken(token) {
	if (!isBrowser() || !token) {
		return;
	}

	localStorage.setItem("token", token);
}

function removeToken() {
	if (!isBrowser()) {
		return;
	}

	localStorage.removeItem("token");
}

function isAuthenticated() {
	return Boolean(getToken());
}

module.exports = {
	getToken,
	setToken,
	removeToken,
	isAuthenticated,
};
