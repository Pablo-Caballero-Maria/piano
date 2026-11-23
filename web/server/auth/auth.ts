/**
 * Better Auth for piano: accounts with a username, a role (teacher or student) and a password that
 * never leaves the browser, and sessions the Python API accepts. The same configuration runs on the
 * teacher's PC (server.ts, a Node process next to the PC app) and on Vercel (vercel.ts).
 *
 * - Username + password (the username plugin). The "password" is the PBKDF2 key the browser derives
 *   (web/src/lib/credentials.ts), hashed as before (password.ts). Better Auth requires an e-mail:
 *   it's derived from the username (adapter.ts → emailOf), and signing in by e-mail is off.
 * - Sessions: the signed token comes back in the `set-auth-token` header (the bearer plugin) and the
 *   page sends it as `Authorization: Bearer …`, to Better Auth and to the Python API, which checks
 *   the signature with the same secret (pianocore/auth.py). 30 days, renewed daily.
 * - Before signing up, the name is checked on this side's store and, on a teacher's PC, in Atlas.
 *   Before signing in, the password picks the account among those that sign in with that name (an
 *   account renamed by a sync keeps its old name, which may be someone else's now).
 */
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, username } from "better-auth/plugins";
import { emailOf, pianoAdapter } from "./adapter.js";
import type { SystemKeys } from "./keys.js";
import { hashPasswordKey, PASSWORD_KEY, verifyPasswordKey } from "./password.js";
import type { AccountsStore } from "./store.js";

/** pianocore/models.py's USERNAME_RE. */
export const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
export const ROLES = ["teacher", "student"] as const;
export const SESSION_DAYS = 30;

export interface PianoAuthOptions {
  store: AccountsStore;
  keys: SystemKeys;
  /** The hosts this server answers as (Better Auth builds its URLs and checks origins with them). */
  allowedHosts: string[];
  /** Better Auth's per-address rate limit (off for the end-to-end tests: every phone is 127.0.0.1). */
  rateLimit?: boolean;
}

const bodyOf = (ctx: { body?: unknown }): Record<string, unknown> =>
  ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};

export function createPianoAuth({ store, keys, allowedHosts, rateLimit = true }: PianoAuthOptions) {
  return betterAuth({
    appName: "ESP32 Piano",
    secret: keys.secret,
    baseURL: { allowedHosts, protocol: "auto" },
    basePath: "/api/auth",
    database: pianoAdapter(store, keys.userId),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // the PBKDF2 key: always 64 hex digits
      minPasswordLength: 64,
      maxPasswordLength: 64,
      password: { hash: hashPasswordKey, verify: verifyPasswordKey },
    },
    user: {
      additionalFields: { role: { type: "string", required: true, input: true } },
    },
    session: { expiresIn: SESSION_DAYS * 86_400, updateAge: 86_400 },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (name) => USERNAME.test(name),
      }),
      bearer(),
    ],
    // Only what piano uses: no e-mail sign-in, no changes to accounts, no e-mails at all
    disabledPaths: [
      "/sign-in/email",
      "/update-user",
      "/delete-user",
      "/change-email",
      "/change-password",
      "/set-password",
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/verify-email",
      "/list-accounts",
      "/link-social",
      "/unlink-account",
    ],
    rateLimit: { enabled: rateLimit, storage: "memory" },
    // The PC app and Vercel are proxies in front of it: the public host and the phone's address
    // arrive in X-Forwarded-*
    advanced: {
      cookiePrefix: "piano",
      trustedProxyHeaders: true,
      // One address: the phone's (the PC app sets it, see fog/auth_server.py; Vercel sets its own)
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    telemetry: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = bodyOf(ctx);
        const name = typeof body.username === "string" ? body.username : "";
        const key = typeof body.password === "string" ? body.password : "";
        if (
          (ctx.path === "/sign-up/email" || ctx.path === "/sign-in/username") &&
          key &&
          !PASSWORD_KEY.test(key)
        )
          throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD_KEY", message: "Bad password key" });
        if (ctx.path === "/sign-up/email") {
          if (!ROLES.includes(body.role as (typeof ROLES)[number]))
            throw new APIError("BAD_REQUEST", { code: "INVALID_ROLE", message: "Choose teacher or student" });
          if (USERNAME.test(name)) {
            Object.assign(body, { name, email: emailOf(name) });
            if (await store.taken(name))
              throw new APIError("BAD_REQUEST", {
                code: "USERNAME_IS_ALREADY_TAKEN",
                message: "That username is already taken",
              });
          }
        }
        if (ctx.path === "/sign-in/username" && USERNAME.test(name) && key) {
          for (const account of await store.candidates(name)) {
            if (await verifyPasswordKey({ hash: `${account.salt}:${account.hash}`, password: key })) {
              body.username = account.username; // the account this password belongs to
              break;
            }
          }
        }
      }),
    },
  });
}

export type PianoAuth = ReturnType<typeof createPianoAuth>;
