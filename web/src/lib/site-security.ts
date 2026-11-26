/**
 * The website's security headers in its two homes, from one definition:
 *
 * - online, on Vercel (vercel.json, kept in step by `npm run headers:vercel` and checked by a
 *   test): HTTPS, and the class through Ably, whose browser SDK comes from Ably's CDN
 *   (services/link/ably-sdk.ts) and connects to Ably's hosts. Preview deployments also let in
 *   Vercel's toolbar; production doesn't.
 * - classroom, on the teacher's PC (fog/security.py, from the out/_server/headers.json the build
 *   writes): plain HTTP on the school's network, and the class through a WebSocket to the PC.
 */
import { ABLY_SDK_URL } from "@/services/link/ably-sdk";
import { securityHeaders, type SecurityOptions } from "./security-headers";

/** Where the website is served from. */
export type Target = "online" | "classroom";

/** The production address; any other Vercel host (previews, deployment URLs) gets the toolbar. */
export const PRODUCTION_HOST = "piano-web-virid.vercel.app";

/** Ably's realtime hosts (main.realtime.ably.net, its fallbacks and connectivity checks). */
export const ABLY_HOSTS = [
  "https://*.ably.net",
  "wss://*.ably.net",
  "https://*.ably-realtime.com",
  "wss://*.ably-realtime.com",
];

export function siteSecurity(target: Target, { preview = false } = {}): SecurityOptions {
  if (target === "classroom") {
    // The class's WebSocket goes to the PC itself (ws://, or wss:// behind a proxy): named
    // explicitly, as older Safari doesn't count ws: as 'self'.
    return { extra: { "connect-src": ["ws:", "wss:"] } };
  }
  return {
    https: true,
    preview,
    extra: { "script-src": [new URL(ABLY_SDK_URL).origin], "connect-src": ABLY_HOSTS },
  };
}

export const siteHeaders = (target: Target, options: { preview?: boolean } = {}) =>
  securityHeaders(siteSecurity(target, options));

export interface VercelHeaderRule {
  source: string;
  has?: { type: "host"; value: string }[];
  missing?: { type: "host"; value: string }[];
  headers: { key: string; value: string }[];
}

/** vercel.json's rules: the strict set on the production host, the one with the toolbar elsewhere. */
export function vercelHeaderRules(): VercelHeaderRule[] {
  const host = [{ type: "host" as const, value: PRODUCTION_HOST }];
  return [
    { source: "/(.*)", has: host, headers: siteHeaders("online") },
    { source: "/(.*)", missing: host, headers: siteHeaders("online", { preview: true }) },
  ];
}
