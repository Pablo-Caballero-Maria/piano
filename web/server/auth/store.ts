/**
 * Where Better Auth keeps piano's accounts and sessions: the accounts API of the Python side
 * (pianocore/accounts_api.py), which stores them sealed on the classroom board or in Atlas with
 * piano's rules (unique usernames system-wide, joining a class, renamed accounts). On the
 * teacher's PC it's the app next door on 127.0.0.1; on Vercel, the Python function of the same
 * deployment. Every call carries the internal token derived from the system key.
 */

export type Role = "teacher" | "student";

/** An account as the accounts API returns it (times in milliseconds). */
export interface Account {
  uid: string;
  /** As typed at sign-up (usernames ignore case). */
  username: string;
  role: Role;
  salt: string;
  hash: string;
  created: number;
  updated: number;
}

/** A sign-in session as the accounts API keeps it. */
export interface StoredSession {
  id: string;
  token: string;
  uid: string;
  expires: number;
  created: number;
  updated: number;
  ip: string;
  agent: string;
}

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
  async function call<T>(path: string, body: unknown): Promise<T> {
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
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new StoreError(data.error ?? `Accounts API: ${response.status}`, response.status);
    return data;
  }
  return {
    find: async (username) => (await call<{ account: Account | null }>("/find", { username })).account,
    candidates: async (username) =>
      (await call<{ accounts: Account[] }>("/candidates", { username })).accounts,
    get: async (uid) => (await call<{ account: Account | null }>("/get", { uid })).account,
    taken: async (username) => (await call<{ taken: boolean }>("/taken", { username })).taken,
    register: async (account) => (await call<{ account: Account }>("/register", account)).account,
    putSession: async (session) => void (await call("/sessions/put", { session })),
    getSession: async (token) =>
      (await call<{ session: StoredSession | null }>("/sessions/get", { token })).session,
    deleteSession: async (token) => void (await call("/sessions/delete", { token })),
    sessionsOf: async (uid) => (await call<{ sessions: StoredSession[] }>("/sessions/of", { uid })).sessions,
    deleteSessionsOf: async (uid) =>
      (await call<{ deleted: number }>("/sessions/delete-of", { uid })).deleted,
  };
}
