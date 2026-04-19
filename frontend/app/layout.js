import "../styles/globals.css";

export const metadata = {
	title: "CodeLens AI",
};

export const viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 1,
	viewportFit: "cover",
};

export default function RootLayout({ children }) {
	return (
		<html lang="en">
			<head>
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
			</head>
			<body>{children}</body>
		</html>
	);
}