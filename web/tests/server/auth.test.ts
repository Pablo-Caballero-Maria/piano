// @vitest-environment node
/**
 * Better Auth with piano's configuration (web/server/auth/auth.ts) on an accounts store in memory:
 * the flows the page uses, as HTTP requests to its handler, and what reaches the store.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createPianoAuth, type PianoAuth } from "../../server/auth/auth";
import { systemKeys } from "../../server/auth/keys";
import { hashPasswordKey, splitHash } from "../../server/auth/password";
import { DATA_KEY } from "./keys.test";
import { MemoryStore } from "./memory-store";

const ORIGIN = "http://localhost:8080";
const KEY = "ab".repeat(32);
const KEY2 = "cd".repeat(32);
const keys = systemKeys(DATA_KEY);

let store: MemoryStore;
let auth: PianoAuth;

beforeEach(() => {
  store = new MemoryStore(keys.userId);
  auth = createPianoAuth({ store, keys, allowedHosts: ["localhost:*"], rateLimit: false });
});

async function call(path: string, body?: unknown, token?: string) {
  const headers = new Headers({ origin: ORIGIN });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    token: response.headers.get("set-auth-token"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- several JSON shapes
    body: (text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as any,
  };
}

const signUp = (username: string, role = "student", password = KEY) =>
  call("/sign-up/email", { username, name: username, email: "x@y.z", role, password });
const signIn = (username: string, password = KEY) => call("/sign-in/username", { username, password });

describe("signing up", () => {
  it("registers the account with piano's hash and hands out a signed session token", async () => {
    const r = await signUp("Ana", "teacher");
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: "ana", displayUsername: "Ana", role: "teacher" });
    expect(r.body.user.email).toBe("ana@piano.invalid");
    const account = store.accounts.get(keys.userId("ana"))!;
    expect(account).toMatchObject({ username: "Ana", role: "teacher" });
    expect(account.hash).not.toContain(KEY);

    // The token is <token>.<base64 HMAC-SHA256 with the shared secret>: what pianocore/auth.py checks
    const [token, signature] = decodeURIComponent(r.token!).split(".");
    expect(createHmac("sha256", keys.secret).update(token).digest("base64")).toBe(signature);
    const session = store.sessions.get(token)!;
    expect(session.uid).toBe(account.uid);
    expect(session.expires - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });

  it("refuses a name that's taken, a bad role, a bad name and a password that isn't a key", async () => {
    await signUp("ana");
    const taken = await signUp("ANA");
    expect([taken.status, taken.body.code]).toEqual([400, "USERNAME_IS_ALREADY_TAKEN"]);
    expect((await signUp("bob", "admin")).body.code).toBe("INVALID_ROLE");
    expect((await signUp("a b c")).status).toBe(400);
    expect((await signUp("bob", "student", "secret1")).body.code).toBe("INVALID_PASSWORD_KEY");
    expect(store.accounts.size).toBe(1);
  });
});

describe("signing in", () => {
  it("checks the password and opens a session the token reaches", async () => {
    await signUp("Ana", "teacher");
    expect((await signIn("ana", KEY2)).status).toBe(401);
    expect((await signIn("nobody")).status).toBe(401);
    const r = await signIn("ANA");
    expect(r.status).toBe(200);
    const me = await call("/get-session", undefined, r.token!);
    expect(me.body.user).toMatchObject({ displayUsername: "Ana", role: "teacher" });
  });

  it("works for accounts from before Better Auth (the same hash)", async () => {
    const { salt, hash } = splitHash(await hashPasswordKey(KEY));
    store.accounts.set(keys.userId("old"), {
      uid: keys.userId("old"),
      username: "Old",
      role: "student",
      salt,
      hash,
      created: 1,
      updated: 1,
    });
    expect((await signIn("old")).status).toBe(200);
  });

  it("lets the password pick between accounts that sign in with the same name", async () => {
    // A pending "ana" renamed to "ana-2" by a sync keeps signing in as "ana"; so does the other ana
    await signUp("ana", "teacher", KEY2);
    await signUp("ana-2", "student", KEY);
    store.aliases.set(keys.userId("ana"), keys.userId("ana-2"));
    const renamed = await signIn("ana", KEY);
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.displayUsername).toBe("ana-2");
    const other = await signIn("ana", KEY2);
    expect(other.body.user.displayUsername).toBe("ana");
  });
});

describe("the session", () => {
  it("ends when signing out", async () => {
    const { token } = await signUp("ana");
    expect(store.sessions.size).toBe(1);
    expect((await call("/sign-out", {}, token!)).status).toBe(200);
    expect(store.sessions.size).toBe(0);
    expect((await call("/get-session", undefined, token!)).body).toBeNull();
  });

  it("isn't reachable with a forged token", async () => {
    await signUp("ana");
    const forged = encodeURIComponent(`${[...store.sessions.keys()][0]}.AAAA`);
    expect((await call("/get-session", undefined, forged)).body).toBeNull();
  });
});

describe("what piano doesn't use", () => {
  it.each(["/sign-in/email", "/delete-user", "/change-password", "/update-user"])(
    "%s is off",
    async (path) => {
      expect((await call(path, {})).status).toBe(404);
    },
  );
});
