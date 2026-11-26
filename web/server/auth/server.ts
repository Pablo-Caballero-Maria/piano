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
import { parseServerEnv } from "./env.js";
import { systemKeys } from "./keys.js";
import { httpStore } from "./store.js";

const env = parseServerEnv(process.env);
const keys = systemKeys(env.PIANO_DATA_KEY);
const publicHost = new URL(env.PIANO_PUBLIC_URL).host;
const auth = createPianoAuth({
  keys,
  store: httpStore({ url: env.PIANO_ACCOUNTS_URL, internalToken: keys.internalToken }),
  allowedHosts: [publicHost, "localhost:*", "127.0.0.1:*"],
  rateLimit: env.PIANO_AUTH_RATE_LIMIT === "on",
});
const port = env.PIANO_AUTH_PORT;

createServer(toNodeHandler(auth)).listen(port, "127.0.0.1", () => {
  console.warn(`Better Auth listening on 127.0.0.1:${port} for ${publicHost}`);
});
