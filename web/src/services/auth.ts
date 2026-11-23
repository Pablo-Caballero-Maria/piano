/**
 * Accounts through Better Auth (its server: server/auth, at /api/auth on the teacher's PC and on
 * Vercel). Better Auth's client signs up, in and out; the session token it hands out (the
 * `set-auth-token` header) is what the page then sends as `Authorization: Bearer …` to the REST API
 * and the live class. The password never leaves the browser: Better Auth gets its PBKDF2 key.
 */
import { createAuthClient } from "better-auth/client";
import { inferAdditionalFields, usernameClient } from "better-auth/client/plugins";

/** The e-mail address Better Auth requires (the server derives the same one: adapter.ts). */
export const emailOf = (username: string): string => `${username.toLowerCase()}@piano.invalid`;

/** Messages for the user, by Better Auth's error code. */
export const AUTH_ERRORS: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: "Wrong username or password",
  USERNAME_IS_ALREADY_TAKEN: "That username is already taken",
  USERNAME_TOO_SHORT: "The username must be 3-32 letters, digits, _ . or -",
  USERNAME_TOO_LONG: "The username must be 3-32 letters, digits, _ . or -",
  INVALID_USERNAME: "The username must be 3-32 letters, digits, _ . or -",
  INVALID_ROLE: "Choose teacher or student",
};

export function authErrorMessage(status: number, code?: string): string {
  if (code && AUTH_ERRORS[code]) return AUTH_ERRORS[code];
  if (status === 0) return "Can't reach the server";
  if (status === 429) return "Too many attempts: wait a moment and try again";
  if (status === 503) return "Accounts are starting on this PC: try again in a moment";
  return `Server error ${status}`;
}

export function createAccountsClient(fetchFn: typeof fetch) {
  return createAuthClient({
    basePath: "/api/auth",
    fetchOptions: { customFetchImpl: fetchFn },
    plugins: [
      usernameClient(),
      inferAdditionalFields({ user: { role: { type: "string", required: true } } }),
    ],
  });
}

export type AccountsClient = ReturnType<typeof createAccountsClient>;
