import "../styles/globals.css";

export const metadata = {
	title: "CodeLens AI",
};

export default function RootLayout({ children }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}