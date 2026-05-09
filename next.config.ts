import type { NextConfig } from "next";

const envAllowed = process.env.ALLOWED_DEV_ORIGINS
	? process.env.ALLOWED_DEV_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
	: [];

const defaultAllowed = [
	"http://localhost:3000",
	"http://127.0.0.1:3000",
];

// Explicitly set turbopack.root so Next/Turbopack doesn't try to infer the workspace
const nextConfig: NextConfig = {
	allowedDevOrigins: process.env.NODE_ENV === "production" ? [] : Array.from(new Set([...defaultAllowed, ...envAllowed])),
	turbopack: {
		root: /*turbopackIgnore: true*/ __dirname,
	},
};

export default nextConfig;