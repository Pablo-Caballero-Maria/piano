/**
 * Where Better Auth keeps piano's accounts and sessions: the accounts API of the Python side
 * (pianocore/accounts_api.py), which stores them sealed on the classroom board or in Atlas with
 * piano's rules (unique usernames system-wide, joining a class, renamed accounts). On the
 * teacher's PC it's the app next door on 127.0.0.1; on Vercel, the Python function of the same
 * deployment. Every call carries the internal token derived from the system key, and every answer
 * is checked with zod before Better Auth sees it.
 */
import { z } from "../../src/lib/zod.js";

export const roleSchema = z.enum(["teacher", "student"]);
export type Role = z.infer<typeof roleSchema>;

const time = z.number().int().nonnegative();

/** An account as the accounts API returns it (times in milliseconds). */
export const accountSchema = z.object({
  uid: z.string().min(1),
  /** As typed at sign-up (usernames ignore case). */
  username: z.string().min(1),
  role: roleSchema,
  salt: z.string(),
  hash: z.string(),
  created: time,
  updated: time,
});
export type Account = z.infer<typeof accountSchema>;

/** A sign-in session as the accounts API keeps it. */
export const storedSessionSchema = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  uid: z.string().min(1),
  expires: time,
  created: time,
  updated: time,
  ip: z.string(),
  agent: z.string(),
});
export type StoredSession = z.infer<typeof storedSessionSchema>;

/** The accounts API's answers. */
const answers = {
  account: z.object({ account: accountSchema.nullable() }),
  newAccount: z.object({ account: accountSchema }),
  accounts: z.object({ accounts: z.array(accountSchema) }),
  taken: z.object({ taken: z.boolean() }),
  session: z.object({ session: storedSessionSchema.nullable() }),
  sessions: z.object({ sessions: z.array(storedSessionSchema) }),
  deleted: z.object({ deleted: z.number().int().nonnegative() }),
  ok: z.unknown(),
};

export interface AccountsStore {
  /** The account that signs in as `username` (see `candidates`). */
  find(username: string): Promise<Account | null>;
  /** Every account that may sign in as `username` (a renamed one too); the password picks one. */
  candidates(username: string): Promise<Account[]>;
  get(uid: string): Promise<Account | null>;
  /** Whether a sign-up can't use this name (here or, on a teacher's PC, in Atlas). */
  taken(username: string): Promise<boolean>;
  register(account: { username: string; role: Role; salt: string; hash: string }): Promise<Account>;
  putSession(session: StoredSession): Promise<void>;
  getSession(token: string): Promise<StoredSession | null>;
  deleteSession(token: string): Promise<void>;
  sessionsOf(uid: string): Promise<StoredSession[]>;
  deleteSessionsOf(uid: string): Promise<number>;
}

/** The accounts API refused a call: its status and message (e.g. 409 "That username is already taken"). */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export interface HttpStoreOptions {
  /** The accounts API's base URL (…/internal/accounts), or a function giving it for each call. */
  url: string | (() => string);
  internalToken: string;
  /** More headers for every call, or a function giving them (Vercel's protection on previews). */
  headers?: Record<string, string> | (() => Record<string, string>);
  fetch?: typeof fetch;
}

/** The accounts API over HTTP. */
export function httpStore({
  url,
  internalToken,
  headers = {},
  fetch: fetchFn = fetch,
}: HttpStoreOptions): AccountsStore {
  async function call<T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> {
    const base = typeof url === "function" ? url() : url;
    const response = await fetchFn(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Piano-Internal": internalToken,
        ...(typeof headers === "function" ? headers() : headers),
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = (data as { error?: unknown }).error;
      throw new StoreError(
        typeof error === "string" ? error : `Accounts API: ${response.status}`,
        response.status,
      );
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new StoreError(`Accounts API: unexpected answer to ${path}`, 502);
    return result.data;
  }
  return {
    find: async (username) => (await call("/find", answers.account, { username })).account,
    candidates: async (username) => (await call("/candidates", answers.accounts, { username })).accounts,
    get: async (uid) => (await call("/get", answers.account, { uid })).account,
    taken: async (username) => (await call("/taken", answers.taken, { username })).taken,
    register: async (account) => (await call("/register", answers.newAccount, account)).account,
    putSession: async (session) => void (await call("/sessions/put", answers.ok, { session })),
    getSession: async (token) => (await call("/sessions/get", answers.session, { token })).session,
    deleteSession: async (token) => void (await call("/sessions/delete", answers.ok, { token })),
    sessionsOf: async (uid) => (await call("/sessions/of", answers.sessions, { uid })).sessions,
    deleteSessionsOf: async (uid) => (await call("/sessions/delete-of", answers.deleted, { uid })).deleted,
  };
}
