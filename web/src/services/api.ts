/**
 * Accounts and melodies through the REST API (pianocore/api.py). The same page talks to the
 * teacher's PC in the classroom (data on the classroom board) or to Vercel online (data in
 * MongoDB Atlas); GET /api/config says which. The login session is kept in this browser.
 */
import { checkCredentials, passwordKey } from "@/lib/credentials";
import { decodeNotes, toPayload, type Melody, type MelodyDraft, type MelodySummary } from "@/lib/melody";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/lib/storage";
import { Store } from "@/lib/store";

export type Role = "teacher" | "student";

export interface User {
  username: string;
  role: Role;
}

export interface Session {
  token: string;
  user: User;
}

/** Where this page is: in a classroom (the teacher's PC), online (Vercel), or unreachable. */
export interface ServerConfig {
  mode: "classroom" | "online" | "offline";
  realtime: "ws" | "ably" | null;
}

/** What GET /api/status says about the classroom PC (teachers only). */
export interface PcStatus {
  board: { online: boolean; version?: string };
  internet: boolean;
  sync: { result: string } | null;
  update: { version: string; result?: string };
}

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

function validSession(s: Session | null): Session | null {
  return s?.token && s.user?.username ? s : null;
}

export class ApiClient {
  /** The logged-in session (null: logged out); components read it with useStore(). */
  readonly session: Store<Session | null>;
  private configPromise: Promise<ServerConfig> | null = null;

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
    initial: Session | null = validSession(readJSON<Session>(STORAGE_KEYS.session)),
  ) {
    this.session = new Store(initial);
  }

  /** How this page talks to its server (asked once). */
  config(): Promise<ServerConfig> {
    this.configPromise ??= this.fetchFn("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ServerConfig>) : OFFLINE))
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

  /** fetch() /api…, with the session; throws ApiError on failure (and forgets a rejected session). */
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) {
      if (r.status === 401 && token) this.setSession(null);
      throw new ApiError(data.error || `Server error ${r.status}`, r.status);
    }
    return data as T;
  }

  get = <T>(path: string): Promise<T> => this.call<T>("GET", path);
  post = <T>(path: string, body: unknown = {}): Promise<T> => this.call<T>("POST", path, body);

  // ---- Accounts ------------------------------------------------------------------------------

  /** Log in; returns a notice for the user ("" usually). */
  async login(username: string, password: string): Promise<string> {
    checkCredentials(username, password);
    const r = await this.post<Session & { notice?: string }>("/auth/login", {
      username,
      key: await passwordKey(username, password),
    });
    this.setSession({ token: r.token, user: r.user });
    return r.notice ?? "";
  }

  /** Create an account and log in; returns a notice for the user ("" usually). */
  async register(username: string, password: string, role: Role): Promise<string> {
    checkCredentials(username, password);
    const r = await this.post<Session & { notice?: string }>("/auth/register", {
      username,
      role,
      key: await passwordKey(username, password),
    });
    this.setSession({ token: r.token, user: r.user });
    return r.notice ?? "";
  }

  logout(): void {
    this.setSession(null);
  }

  // ---- Melodies ------------------------------------------------------------------------------

  /** "mine": my melodies; "public": everyone's public ones. */
  async listMelodies(scope: "mine" | "public" = "mine"): Promise<MelodySummary[]> {
    return (await this.get<{ melodies: MelodySummary[] }>(`/melodies?scope=${scope}`)).melodies;
  }

  async getMelody(id: string): Promise<Melody> {
    const m = (await this.get<{ melody: Omit<Melody, "notes"> & { notes: string } }>(`/melodies/${id}`))
      .melody;
    return { ...m, notes: decodeNotes(m.notes) };
  }

  async createMelody(m: MelodyDraft): Promise<MelodySummary> {
    return (await this.post<{ melody: MelodySummary }>("/melodies", toPayload(m))).melody;
  }

  async updateMelody(id: string, m: MelodyDraft): Promise<MelodySummary> {
    return (await this.call<{ melody: MelodySummary }>("PUT", `/melodies/${id}`, toPayload(m))).melody;
  }

  async deleteMelody(id: string): Promise<void> {
    await this.call("DELETE", `/melodies/${id}`);
  }

  // ---- The classroom PC (teachers) -----------------------------------------------------------

  pcStatus = (): Promise<PcStatus> => this.get<PcStatus>("/status");
  checkForUpdates = (): Promise<unknown> => this.post("/update");
}

/** The page's API client. */
export const api = new ApiClient();
