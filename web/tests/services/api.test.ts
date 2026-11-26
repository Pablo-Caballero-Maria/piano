// The REST client and the accounts (Better Auth's client): the session, errors, melodies (fetch is faked).
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "@/services/api";
import { anything } from "@/services/schemas";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

function client(
  replies: Record<string, Reply>,
  session = null as ConstructorParameters<typeof ApiClient>[1],
) {
  const calls: { method: string; url: string; body: unknown; auth?: string }[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = new URL(String(input), "http://localhost:3000");
    const path = url.pathname + url.search;
    calls.push({
      method,
      url: path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get("authorization") ?? undefined,
    });
    const reply = replies[`${method} ${path}`];
    if (!reply) throw new TypeError("network down");
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  });
  return { api: new ApiClient(fetchFn as typeof fetch, session), calls };
}

const SESSION = { token: "tok", user: { username: "ana", role: "teacher" as const } };

/** A melody as pianocore's Melody.summary() sends it. */
const SUMMARY = {
  id: "m1",
  name: "A",
  bpm: 100,
  noteCount: 1,
  length: 3,
  public: true,
  owner: "ana",
  editedBy: "ana",
  createdAt: 1764000000000,
  updatedAt: 1764000000000,
};

describe("ApiClient", () => {
  const SIGNED_IN = { headers: { "set-auth-token": "tok" }, body: { token: "tok", user: {} } };

  it("logs in with Better Auth using the password key (never the password) and remembers the session", async () => {
    const { api, calls } = client({
      "POST /api/auth/sign-in/username": SIGNED_IN,
      "GET /api/me": { body: { user: SESSION.user, notice: "" } },
      "POST /api/auth/sign-out": { body: { success: true } },
    });
    const seen = vi.fn();
    api.session.subscribe(seen);
    expect(await api.login("ana", "secret1")).toBe("");
    expect(calls[0]!.body).toEqual({ username: "ana", password: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(calls[0]!.body)).not.toContain("secret1");
    expect(calls[1]).toMatchObject({ url: "/api/me", auth: "Bearer tok" });
    expect(api.currentUser()).toEqual(SESSION.user);
    expect(api.isTeacher()).toBe(true);
    expect(JSON.parse(localStorage.getItem("piano-session")!)).toEqual(SESSION);
    api.logout();
    expect(api.currentUser()).toBeNull();
    expect(localStorage.getItem("piano-session")).toBeNull();
    await vi.waitFor(() =>
      expect(calls.at(-1)).toMatchObject({ url: "/api/auth/sign-out", auth: "Bearer tok" }),
    );
  });

  it("registers with a role and passes the server's notice on", async () => {
    const { api, calls } = client({
      "POST /api/auth/sign-up/email": SIGNED_IN,
      "GET /api/me": { body: { user: { username: "ana2", role: "student" }, notice: "Renamed" } },
    });
    expect(await api.register("ana", "secret1", "student")).toBe("Renamed");
    expect(calls[0]!.body).toMatchObject({ username: "ana", role: "student", email: "ana@piano.invalid" });
    expect(api.currentUser()?.username).toBe("ana2");
  });

  it("explains Better Auth's refusals", async () => {
    const { api } = client({
      "POST /api/auth/sign-in/username": { status: 401, body: { code: "INVALID_USERNAME_OR_PASSWORD" } },
      "POST /api/auth/sign-up/email": { status: 400, body: { code: "USERNAME_IS_ALREADY_TAKEN" } },
    });
    await expect(api.login("ana", "secret1")).rejects.toMatchObject({
      message: "Wrong username or password",
      status: 401,
    });
    await expect(api.register("ana", "secret1", "student")).rejects.toMatchObject({
      message: "That username is already taken",
    });
    expect(api.currentUser()).toBeNull();
  });

  it("a sign-in the server can't follow up leaves nobody logged in", async () => {
    const { api } = client({ "POST /api/auth/sign-in/username": SIGNED_IN });
    await expect(api.login("ana", "secret1")).rejects.toMatchObject({ status: 0 });
    expect(api.currentUser()).toBeNull();
    const noToken = client({ "POST /api/auth/sign-in/username": { body: {} } });
    await expect(noToken.api.login("ana", "secret1")).rejects.toThrow(/didn't start a session/);
  });

  it("an unreachable accounts server is status 0", async () => {
    const { api } = client({});
    await expect(api.login("ana", "secret1")).rejects.toMatchObject({
      status: 0,
      message: "Can't reach the server",
    });
  });

  it("bad credentials never reach the server", async () => {
    const { api, calls } = client({});
    await expect(api.login("a", "secret1")).rejects.toThrow(/username/);
    expect(calls).toEqual([]);
  });

  it("sends the session and forgets it when the server rejects it", async () => {
    const { api, calls } = client(
      { "GET /api/melodies?scope=mine": { status: 401, body: { error: "Log in first" } } },
      SESSION,
    );
    const err = await api.listMelodies().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "Log in first", status: 401 });
    expect(calls[0]!.auth).toBe("Bearer tok");
    expect(api.currentUser()).toBeNull();
  });

  it("an unreachable server is status 0", async () => {
    const { api } = client({});
    await expect(api.get("/anything", anything)).rejects.toMatchObject({
      status: 0,
      message: "Can't reach the server",
    });
  });

  it("an answer of the wrong shape is an error, not a crash later", async () => {
    const { api } = client({ "GET /api/melodies?scope=mine": { body: { melodies: [{ id: 1 }] } } }, SESSION);
    await expect(api.listMelodies()).rejects.toMatchObject({
      message: "The server sent an unexpected answer",
      status: 200,
    });
  });

  it("melodies: notes decoded, payloads encoded", async () => {
    const { api, calls } = client(
      {
        "GET /api/melodies/m1": {
          body: { melody: { id: "m1", name: "A", bpm: 100, notes: "60:0:1", public: false, owner: "ana" } },
        },
        "PUT /api/melodies/m1": { body: { melody: SUMMARY } },
        "DELETE /api/melodies/m1": { body: { ok: true } },
      },
      SESSION,
    );
    expect((await api.getMelody("m1")).notes).toEqual([{ p: 60, s: 0, d: 1 }]);
    await api.updateMelody("m1", { name: "A", bpm: 100, notes: [{ p: 62, s: 1, d: 2 }], public: true });
    expect(calls[1]!.body).toEqual({ name: "A", bpm: 100, notes: "62:1:2", length: 3, public: true });
    await api.deleteMelody("m1");
    expect(calls[2]!.method).toBe("DELETE");
  });

  it("asks for the server's config once; offline if it can't", async () => {
    const { api, calls } = client({});
    expect(await api.config()).toEqual({ mode: "offline", realtime: null });
    await api.config();
    expect(calls).toHaveLength(1);
  });
});
