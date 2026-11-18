// The REST client: the session, errors, melodies (fetch is faked).
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "@/services/api";

type Reply = { status?: number; body?: unknown };

function client(
  replies: Record<string, Reply>,
  session = null as ConstructorParameters<typeof ApiClient>[1],
) {
  const calls: { method: string; url: string; body: unknown; auth?: string }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      method,
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.Authorization,
    });
    const reply = replies[`${method} ${String(url)}`];
    if (!reply) throw new TypeError("network down");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  return { api: new ApiClient(fetchFn as typeof fetch, session), calls };
}

const SESSION = { token: "tok", user: { username: "ana", role: "teacher" as const } };

describe("ApiClient", () => {
  it("logs in with the password key (never the password) and remembers the session", async () => {
    const { api, calls } = client({ "POST /api/auth/login": { body: { ...SESSION, notice: "" } } });
    const seen = vi.fn();
    api.session.subscribe(seen);
    expect(await api.login("ana", "secret1")).toBe("");
    expect(calls[0]!.body).toEqual({ username: "ana", key: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(calls[0]!.body)).not.toContain("secret1");
    expect(api.currentUser()).toEqual(SESSION.user);
    expect(api.isTeacher()).toBe(true);
    expect(JSON.parse(localStorage.getItem("piano-session")!)).toEqual(SESSION);
    expect(seen).toHaveBeenCalledTimes(1);
    api.logout();
    expect(api.currentUser()).toBeNull();
    expect(localStorage.getItem("piano-session")).toBeNull();
  });

  it("registers with a role and passes the server's notice on", async () => {
    const { api, calls } = client({
      "POST /api/auth/register": {
        body: { ...SESSION, user: { username: "ana2", role: "student" }, notice: "Renamed" },
      },
    });
    expect(await api.register("ana", "secret1", "student")).toBe("Renamed");
    expect(calls[0]!.body).toMatchObject({ username: "ana", role: "student" });
    expect(api.currentUser()?.username).toBe("ana2");
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
    await expect(api.get("/anything")).rejects.toMatchObject({
      status: 0,
      message: "Can't reach the server",
    });
  });

  it("melodies: notes decoded, payloads encoded", async () => {
    const { api, calls } = client(
      {
        "GET /api/melodies/m1": {
          body: { melody: { id: "m1", name: "A", bpm: 100, notes: "60:0:1", public: false, owner: "ana" } },
        },
        "PUT /api/melodies/m1": { body: { melody: { id: "m1", name: "A" } } },
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
