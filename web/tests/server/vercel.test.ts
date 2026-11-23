// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAuth, protectionHeaders } from "../../server/auth/vercel";
import { DATA_KEY } from "./keys.test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Better Auth on Vercel", () => {
  it("passes on what got the request past a preview's protection", () => {
    const request = new Request("https://piano-web-git-x.vercel.app/api/auth/ok", {
      headers: { cookie: "a=1; _vercel_jwt=abc.def; b=2", "x-vercel-protection-bypass": "s3cret" },
    });
    expect(protectionHeaders(request)).toEqual({
      cookie: "_vercel_jwt=abc.def",
      "x-vercel-protection-bypass": "s3cret",
    });
    expect(protectionHeaders(new Request("https://piano-web-virid.vercel.app/"))).toEqual({});
    const viaCli = new Request("https://piano-web-git-x.vercel.app/", {
      headers: { "x-vercel-trusted-oidc-idp-token": "oidc" },
    });
    expect(protectionHeaders(viaCli)).toEqual({ "x-vercel-trusted-oidc-idp-token": "oidc" });
  });

  it("asks the accounts API of the host the request came to, with the request's pass", async () => {
    vi.stubEnv("PIANO_DATA_KEY", DATA_KEY);
    const fetch = vi.fn(async () => Response.json({ accounts: [] }));
    vi.stubGlobal("fetch", fetch);
    const response = await handleAuth(
      new Request("https://piano-web-git-x.vercel.app/api/auth/sign-in/username", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://piano-web-git-x.vercel.app",
          cookie: "_vercel_jwt=pass",
        },
        body: JSON.stringify({ username: "ana", password: "ab".repeat(32) }),
      }),
    );
    expect(response.status).toBe(401);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://piano-web-git-x.vercel.app/api/internal/accounts/candidates");
    expect(new Headers(init.headers).get("cookie")).toBe("_vercel_jwt=pass");
  });
});
