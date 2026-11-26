// The security headers online (vercel.json) and in the classroom (the teacher's PC).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ABLY_SDK_URL } from "@/services/link/ably-sdk";
import { PRODUCTION_HOST, siteHeaders, vercelHeaderRules } from "@/lib/site-security";

const csp = (headers: { key: string; value: string }[]) =>
  Object.fromEntries(
    headers
      .find((h) => h.key === "Content-Security-Policy")!
      .value.split("; ")
      .map((d) => [d.split(" ")[0], d.split(" ").slice(1)]),
  );

describe("site security", () => {
  it("online: Ably's SDK and hosts, HTTPS only", () => {
    const policy = csp(siteHeaders("online"));
    expect(policy["script-src"]).toEqual(["'self'", "'unsafe-inline'", new URL(ABLY_SDK_URL).origin]);
    expect(policy["connect-src"]).toContain("wss://*.ably.net");
    expect(policy["connect-src"]).toContain("https://*.ably-realtime.com");
    expect(policy).toHaveProperty("upgrade-insecure-requests");
    expect(policy["script-src"]).not.toContain("https://vercel.live");
  });

  it("previews also let Vercel's toolbar in", () => {
    expect(csp(siteHeaders("online", { preview: true }))["script-src"]).toContain("https://vercel.live");
  });

  it("classroom: plain HTTP and the PC's WebSocket, nothing from the internet", () => {
    const policy = csp(siteHeaders("classroom"));
    expect(policy["connect-src"]).toEqual(["'self'", "ws:", "wss:"]);
    expect(policy["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("vercel.json has the current rules (npm run headers:vercel), and keeps its others", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "..", "vercel.json"), "utf8")) as {
      headers: { source: string }[];
    };
    expect(config.headers.slice(0, 2)).toEqual(vercelHeaderRules());
    expect(config.headers.map((rule) => rule.source)).toEqual([
      "/(.*)",
      "/(.*)",
      "/_next/static/(.*)",
      "/serwist/(.*)",
    ]);
    expect(vercelHeaderRules()[0]).toMatchObject({ has: [{ type: "host", value: PRODUCTION_HOST }] });
    expect(vercelHeaderRules()[1]).toMatchObject({ missing: [{ type: "host", value: PRODUCTION_HOST }] });
  });
});
