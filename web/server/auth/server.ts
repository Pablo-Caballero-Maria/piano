/**
 * Better Auth on the teacher's PC: an HTTP server on 127.0.0.1 that the PC app (fog/auth_server.py)
 * starts, keeps running and forwards /api/auth/* to. Bundled by `npm run build` into
 * out/_server/auth.mjs (scripts/build-auth-server.mjs), so it needs nothing but Node.js.
 *
 * Environment (set by fog/auth_server.py): PIANO_DATA_KEY, PIANO_AUTH_PORT, PIANO_ACCOUNTS_URL
 * (the PC app's accounts API), PIANO_PUBLIC_URL (the classroom's address), and
 * PIANO_AUTH_RATE_LIMIT=off for the end-to-end tests.
 */
import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { createPianoAuth } from "./auth.js";
import { systemKeys } from "./keys.js";
import { httpStore } from "./store.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const keys = systemKeys(required("PIANO_DATA_KEY"));
const publicHost = new URL(process.env.PIANO_PUBLIC_URL || "https://localhost").host;
const auth = createPianoAuth({
  keys,
  store: httpStore({ url: required("PIANO_ACCOUNTS_URL"), internalToken: keys.internalToken }),
  allowedHosts: [publicHost, "localhost:*", "127.0.0.1:*"],
  rateLimit: process.env.PIANO_AUTH_RATE_LIMIT !== "off",
});
const port = Number(required("PIANO_AUTH_PORT"));

createServer(toNodeHandler(auth)).listen(port, "127.0.0.1", () => {
  console.warn(`Better Auth listening on 127.0.0.1:${port} for ${publicHost}`);
});
