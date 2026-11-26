/**
 * The environment of Better Auth's server on the teacher's PC (set by fog/auth_server.py), checked
 * with zod: one clear error at start-up instead of a failure later.
 */
import { z } from "../../src/lib/zod.js";

const set = (name: string) =>
  z
    .string({ error: `${name} is not set` })
    .trim()
    .min(1, `${name} is not set`);

export const serverEnvSchema = z.object({
  /** The system key (accounts, sessions and the internal token derive from it). */
  PIANO_DATA_KEY: set("PIANO_DATA_KEY"),
  /** The PC app's accounts API. */
  PIANO_ACCOUNTS_URL: set("PIANO_ACCOUNTS_URL").pipe(z.url("PIANO_ACCOUNTS_URL must be a URL")),
  PIANO_AUTH_PORT: set("PIANO_AUTH_PORT")
    .transform(Number)
    .pipe(
      z
        .number()
        .int("PIANO_AUTH_PORT must be a port number")
        .min(1)
        .max(65535, "PIANO_AUTH_PORT must be a port number"),
    ),
  /** The classroom's address (its host is the one Better Auth accepts). */
  PIANO_PUBLIC_URL: z
    .string()
    .optional()
    .transform((url) => url?.trim() || "https://localhost")
    .pipe(z.url("PIANO_PUBLIC_URL must be a URL")),
  /** "off" for the end-to-end tests (all their browsers share one address). */
  PIANO_AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
});

export type ServerEnv = z.output<typeof serverEnvSchema>;

/** Parses the environment; throws one error listing every problem. */
export function parseServerEnv(env: Readonly<Record<string, string | undefined>>): ServerEnv {
  const result = serverEnvSchema.safeParse(env);
  if (result.success) return result.data;
  throw new Error(result.error.issues.map((issue) => issue.message).join("; "));
}
