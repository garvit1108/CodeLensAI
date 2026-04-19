import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { isAuthenticated } from "../utils/auth";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
	const router = useRouter();
	const [authChecked, setAuthChecked] = useState(false);

	// Initial auth check on app mount
	useEffect(() => {
		setAuthChecked(true);
	}, []);

	// Check authentication on route change and detect token changes
	useEffect(() => {
		const publicPages = ["/", "/login", "/signup"];
		const isPublicPage = publicPages.includes(router.pathname);

		// If not on a public page and no token, redirect to login
		if (!isPublicPage && !isAuthenticated()) {
			router.replace("/login");
		}
	}, [router.pathname]);

	// Detect token removal (e.g., in another tab) or manual localStorage changes
	useEffect(() => {
		const handleStorageChange = (e) => {
			// If token key was removed/cleared
			if (e.key === "token" && e.newValue === null) {
				// Redirect to login if not already there
				if (router.pathname !== "/login") {
					router.replace("/login");
				}
			}
		};

		if (typeof window !== "undefined") {
			window.addEventListener("storage", handleStorageChange);
			return () => window.removeEventListener("storage", handleStorageChange);
		}
	}, [router]);

	// Show loading while checking auth to prevent content flash
	if (!authChecked) {
		return null;
	}

	return (
		<>
			<Head>
				<title>CodeLens AI</title>
				<meta name="viewport" content="width=device-width, initial-scale=1" />
			</Head>
			<Component {...pageProps} />
		</>
	);
}
