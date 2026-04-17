import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function ProtectedRoute({ children }) {
	const router = useRouter();
	const [isAuthenticated, setIsAuthenticated] = useState(null); // null = checking, true = authed, false = not authed

	useEffect(() => {
		const token = localStorage.getItem("token");

		if (!token) {
			router.replace("/login");
			setIsAuthenticated(false);
			return;
		}

		setIsAuthenticated(true);
	}, [router]);

	// Show loading screen while checking authentication
	if (isAuthenticated === null) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
				<div className="text-center">
					<div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-sky-500"></div>
					<p className="text-slate-400">Authenticating...</p>
				</div>
			</div>
		);
	}

	// Don't render children if not authenticated
	if (!isAuthenticated) {
		return null;
	}

	return children;
}
