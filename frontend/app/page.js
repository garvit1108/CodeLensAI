"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CodeEditor from "../components/CodeEditor";

export default function Home() {
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