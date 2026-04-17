import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import CodeEditor from "../components/CodeEditor";

export default function HomePage() {
	const router = useRouter();
	const [isCheckingAuth, setIsCheckingAuth] = useState(true);

	useEffect(() => {
		const token = localStorage.getItem("token");

		if (!token) {
			router.replace("/login");
			return;
		}

		setIsCheckingAuth(false);
	}, [router]);

	if (isCheckingAuth) {
		return null;
	}

	return <CodeEditor />;
}
