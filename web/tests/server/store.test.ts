// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { httpStore, StoreError } from "../../server/auth/store";

/** An account as pianocore/accounts_api.py sends it. */
const ACCOUNT = {
  uid: "u1",
  username: "Ana",
  role: "student",
  salt: "00".repeat(16),
  hash: "11".repeat(32),
  created: 1,
  updated: 1,
};

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify(body), { status }));
}

describe("the accounts API over HTTP", () => {
  it("POSTs JSON with the internal token and unwraps the answer", async () => {
    const fetch = fakeFetch(200, { account: ACCOUNT });
    const store = httpStore({ url: "http://127.0.0.1:8080/internal/accounts", internalToken: "tok", fetch });
    expect(await store.find("ana")).toEqual(ACCOUNT);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8080/internal/accounts/find");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("x-piano-internal")).toBe("tok");
    expect(JSON.parse(String(init?.body))).toEqual({ username: "ana" });
  });

  it("asks a function for the URL on every call, and adds extra headers", async () => {
    const fetch = fakeFetch(200, { taken: true });
    let host = "https://a.example";
    const store = httpStore({
      url: () => `${host}/api/internal/accounts`,
      internalToken: "tok",
      headers: { "x-vercel-protection-bypass": "secret" },
      fetch,
    });
    expect(await store.taken("ana")).toBe(true);
    host = "https://b.example";
    await store.taken("bob");
    expect(fetch.mock.calls.map(([u]) => u)).toEqual([
      "https://a.example/api/internal/accounts/taken",
      "https://b.example/api/internal/accounts/taken",
    ]);
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("x-vercel-protection-bypass")).toBe("secret");
  });

  it("maps every call to its route", async () => {
    const fetch = fakeFetch(200, { account: ACCOUNT, accounts: [], session: null, sessions: [], deleted: 2 });
    const store = httpStore({ url: "http://x", internalToken: "t", fetch });
    await store.candidates("ana");
    await store.get("u1");
    await store.register({ username: "ana", role: "student", salt: "s", hash: "h" });
    await store.putSession({
      id: "i",
      token: "t",
      uid: "u",
      expires: 1,
      created: 1,
      updated: 1,
      ip: "",
      agent: "",
    });
    await store.getSession("t");
    await store.deleteSession("t");
    await store.sessionsOf("u");
    expect(await store.deleteSessionsOf("u")).toBe(2);
    expect(fetch.mock.calls.map(([u]) => String(u).slice("http://x".length))).toEqual([
      "/candidates",
      "/get",
      "/register",
      "/sessions/put",
      "/sessions/get",
      "/sessions/delete",
      "/sessions/of",
      "/sessions/delete-of",
    ]);
  });

  it("refuses an answer that isn't what the API sends (zod)", async () => {
    const store = httpStore({
      url: "http://x",
      internalToken: "t",
      fetch: fakeFetch(200, { account: { uid: "u1" } }),
    });
    await expect(store.find("ana")).rejects.toMatchObject({
      name: "StoreError",
      status: 502,
      message: "Accounts API: unexpected answer to /find",
    });
  });

  it("turns a refusal into a StoreError with the API's message", async () => {
    const store = httpStore({
      url: "http://x",
      internalToken: "t",
      fetch: fakeFetch(409, { error: "Taken" }),
    });
    await expect(store.register({ username: "a", role: "student", salt: "", hash: "" })).rejects.toEqual(
      new StoreError("Taken", 409),
    );
    const silent = httpStore({ url: "http://x", internalToken: "t", fetch: fakeFetch(500, "oops") });
    await expect(silent.get("u")).rejects.toThrow("Accounts API: 500");
  });
});
