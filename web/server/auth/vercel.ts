/**
 * Better Auth on Vercel: the Node function api/auth.ts hands every /api/auth/* request here. Its
 * store is the accounts API of the Python function of the same deployment (api/index.py, at
 * /api/internal/accounts), reached on the host the request came to.
 *
 * Environment (Vercel's settings): PIANO_DATA_KEY, the same system key as the Python function and
 * the teacher PCs. Preview deployments are behind Vercel's protection: the internal calls carry the
 * request's own pass (its _vercel_jwt cookie, a bypass header or a trusted-source token, as `vercel
 * curl` sends), or VERCEL_AUTOMATION_BYPASS_SECRET when the project has one.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createPianoAuth, type PianoAuth } from "./auth.js";
import { systemKeys } from "./keys.js";
import { httpStore } from "./store.js";

/** Where this request came in, and what got it past Vercel's protection (previews). */
interface Incoming {
  origin: string;
  headers: Record<string, string>;
}

const incoming = new AsyncLocalStorage<Incoming>();
let auth: PianoAuth | undefined;

/** What let the browser past the protection of a preview deployment, to pass it on. */
export function protectionHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const jwt = request.headers.get("cookie")?.match(/(?:^|;\s*)(_vercel_jwt=[^;]+)/)?.[1];
  if (jwt) headers.cookie = jwt;
  const bypass =
    request.headers.get("x-vercel-protection-bypass") ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const trusted = request.headers.get("x-vercel-trusted-oidc-idp-token");
  if (trusted) headers["x-vercel-trusted-oidc-idp-token"] = trusted;
  return headers;
}

function getAuth(): PianoAuth {
  if (auth) return auth;
  const dataKey = process.env.PIANO_DATA_KEY?.trim();
  if (!dataKey) throw new Error("The server isn't configured (PIANO_DATA_KEY is missing)");
  const keys = systemKeys(dataKey);
  auth = createPianoAuth({
    keys,
    store: httpStore({
      url: () => `${incoming.getStore()?.origin}/api/internal/accounts`,
      internalToken: keys.internalToken,
      headers: () => incoming.getStore()?.headers ?? {},
    }),
    allowedHosts: ["piano-web-virid.vercel.app", "piano-web-*.vercel.app", "localhost:*"],
  });
  return auth;
}

/** Answers one /api/auth/* request. */
export async function handleAuth(request: Request): Promise<Response> {
  let instance: PianoAuth;
  try {
    instance = getAuth();
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
  const call = { origin: new URL(request.url).origin, headers: protectionHeaders(request) };
  return incoming.run(call, () => instance.handler(request));
}
