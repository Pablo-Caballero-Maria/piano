/**
 * Accounts and melodies. Signing up, in and out goes through Better Auth (services/auth.ts); the
 * melodies and the rest through the REST API (pianocore/api.py), with Better Auth's session token.
 * The same page talks to the teacher's PC in the classroom (data on the classroom board) or to
 * Vercel online (data in MongoDB Atlas); GET /api/config says which. The login session (the token
 * and who it is) is kept in this browser.
 */
import { checkCredentials, passwordKey } from "@/lib/credentials";
import { decodeNotes, toPayload, type Melody, type MelodyDraft, type MelodySummary } from "@/lib/melody";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/lib/storage";
import { Store } from "@/lib/store";
import type { z } from "@/lib/zod";
import { authErrorMessage, createAccountsClient, emailOf, type AccountsClient } from "./auth";
import {
  anything,
  meSchema,
  melodiesSchema,
  melodySchema,
  pcStatusSchema,
  savedMelodySchema,
  serverConfigSchema,
  sessionSchema,
  type roleSchema,
  type userSchema,
} from "./schemas";

export type Role = z.infer<typeof roleSchema>;

export type User = z.infer<typeof userSchema>;

export type Session = z.infer<typeof sessionSchema>;

/** Where this page is: in a classroom (the teacher's PC), online (Vercel), or unreachable. */
export type ServerConfig = z.infer<typeof serverConfigSchema>;

/** What GET /api/status says about the classroom PC (teachers only). */
export type PcStatus = z.infer<typeof pcStatusSchema>;

/** An API call that failed: message is for the user; status 0 means the server wasn't reached. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE: ServerConfig = { mode: "offline", realtime: null };

export class ApiClient {
  /** The logged-in session (null: logged out); components read it with useStore(). */
  readonly session: Store<Session | null>;
  private readonly accounts: AccountsClient;
  private configPromise: Promise<ServerConfig> | null = null;

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
    initial: Session | null = readJSON(STORAGE_KEYS.session, sessionSchema),
  ) {
    this.session = new Store(initial);
    this.accounts = createAccountsClient(fetchFn);
  }

  /** How this page talks to its server (asked once). */
  config(): Promise<ServerConfig> {
    this.configPromise ??= this.fetchFn("/api/config", { cache: "no-store" })
      .then(async (r) => (r.ok ? serverConfigSchema.parse(await r.json()) : OFFLINE))
      .catch(() => OFFLINE);
    return this.configPromise;
  }

  currentUser = (): User | null => this.session.get()?.user ?? null;
  token = (): string | null => this.session.get()?.token ?? null;
  isTeacher = (): boolean => this.currentUser()?.role === "teacher";

  private setSession(s: Session | null): void {
    writeJSON(STORAGE_KEYS.session, s);
    this.session.set(s);
  }

  /**
   * fetch() /api…, with the session, and check the answer against `schema`; throws ApiError on
   * failure (and forgets a rejected session) or when the answer isn't what was expected.
   */
  async call<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    let r: Response;
    try {
      r = await this.fetchFn(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError("Can't reach the server", 0);
    }
    const data: unknown = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && token) this.setSession(null);
      const error = (data as { error?: unknown }).error;
      throw new ApiError(typeof error === "string" && error ? error : `Server error ${r.status}`, r.status);
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new ApiError("The server sent an unexpected answer", r.status);
    return result.data;
  }

  get = <T>(path: string, schema: z.ZodType<T>): Promise<T> => this.call("GET", path, schema);
  post = <T>(path: string, schema: z.ZodType<T>, body: unknown = {}): Promise<T> =>
    this.call("POST", path, schema, body);

  // ---- Accounts ------------------------------------------------------------------------------

  /**
   * Runs a Better Auth call and returns the session token it hands out; its errors become
   * ApiErrors with a message for the user.
   */
  private async authenticate(
    run: (onSuccess: (ctx: { response: Response }) => void) => Promise<{ error: unknown }>,
  ): Promise<string> {
    let token: string | null = null;
    let result: { error: unknown };
    try {
      result = await run(({ response }) => (token = response.headers.get("set-auth-token")));
    } catch {
      throw new ApiError(authErrorMessage(0), 0);
    }
    const error = result.error as { status?: number; code?: string } | null;
    if (error) throw new ApiError(authErrorMessage(error.status ?? 0, error.code), error.status ?? 0);
    if (!token) throw new ApiError("The server didn't start a session", 500);
    return token;
  }

  /** With Better Auth's token: who it is (and a notice for them), from the REST API. */
  private async startSession(token: string): Promise<string> {
    this.session.set({ token, user: { username: "", role: "student" } }); // so call() sends it
    try {
      const me = await this.get("/me", meSchema);
      this.setSession({ token, user: me.user });
      return me.notice ?? "";
    } catch (e) {
      this.setSession(null);
      throw e;
    }
  }

  /** Log in; returns a notice for the user ("" usually). */
  async login(username: string, password: string): Promise<string> {
    checkCredentials(username, password);
    const key = await passwordKey(username, password);
    const token = await this.authenticate((onSuccess) =>
      this.accounts.signIn.username({ username, password: key }, { onSuccess }),
    );
    return this.startSession(token);
  }

  /** Create an account and log in; returns a notice for the user ("" usually). */
  async register(username: string, password: string, role: Role): Promise<string> {
    checkCredentials(username, password);
    const key = await passwordKey(username, password);
    const token = await this.authenticate((onSuccess) =>
      this.accounts.signUp.email(
        { username, name: username, email: emailOf(username), password: key, role },
        { onSuccess },
      ),
    );
    return this.startSession(token);
  }

  /** Log out here at once, and end the session on the server (if it's reachable). */
  logout(): void {
    const token = this.token();
    this.setSession(null);
    if (token)
      void this.accounts
        .signOut({ fetchOptions: { headers: { Authorization: `Bearer ${token}` } } })
        .catch(() => {});
  }

  // ---- Melodies ------------------------------------------------------------------------------

  /** "mine": my melodies; "public": everyone's public ones. */
  async listMelodies(scope: "mine" | "public" = "mine"): Promise<MelodySummary[]> {
    return (await this.get(`/melodies?scope=${scope}`, melodiesSchema)).melodies;
  }

  async getMelody(id: string): Promise<Melody> {
    const m = (await this.get(`/melodies/${id}`, melodySchema)).melody;
    return { ...m, notes: decodeNotes(m.notes) };
  }

  async createMelody(m: MelodyDraft): Promise<MelodySummary> {
    return (await this.post("/melodies", savedMelodySchema, toPayload(m))).melody;
  }

  async updateMelody(id: string, m: MelodyDraft): Promise<MelodySummary> {
    return (await this.call("PUT", `/melodies/${id}`, savedMelodySchema, toPayload(m))).melody;
  }

  async deleteMelody(id: string): Promise<void> {
    await this.call("DELETE", `/melodies/${id}`, anything);
  }

  // ---- The classroom PC (teachers) -----------------------------------------------------------

  pcStatus = (): Promise<PcStatus> => this.get("/status", pcStatusSchema);
  checkForUpdates = (): Promise<unknown> => this.post("/update", anything);
}

/** The page's API client. */
export const api = new ApiClient();
