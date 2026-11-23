/**
 * The website is a static export (`next build` → out/): one HTML page plus its scripts and styles.
 * Everything it shows is live (the class, the user's melodies), so there is nothing to render on a
 * server, and the same files are served two ways:
 *
 * - online, by Vercel (vercel.json), next to the API function api/index.py;
 * - in the classroom, by the teacher's PC (fog/app.py), with no internet needed.
 *
 * `npm run dev` serves the page with hot reload and sends /api and /ws (the live class) to the PC's
 * app running locally: `uv run python -m fog demo` (http://127.0.0.1:8080, or PIANO_BACKEND).
 *
 * The styles are Tailwind CSS v4 (src/app/globals.css), compiled by its Turbopack loader.
 * withSerwist keeps esbuild, which builds the service worker (src/app/serwist/[path]/route.ts), out
 * of the server bundle.
 */
import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const BACKEND = process.env.PIANO_BACKEND ?? "http://127.0.0.1:8080";

const base: NextConfig = withSerwist({
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
});

export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...base,
      rewrites: async () => [
        { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
        { source: "/ws", destination: `${BACKEND}/ws` },
      ],
    };
  }
  return { ...base, output: "export" };
}
