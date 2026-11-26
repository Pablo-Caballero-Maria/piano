import { expect, test } from "./fixtures";

// The headers the teacher's PC sends (fog/security.py, from the build's out/_server/headers.json).
// Every other test fails on a Content Security Policy violation (fixtures.ts).
test("the PC sends the security headers with every response", async ({ request }) => {
  for (const path of ["/", "/serwist/sw.js", "/api/config", "/api/auth/ok"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["content-security-policy"], path).toContain("default-src 'self'");
    expect(headers["content-security-policy"], path).toContain("connect-src 'self' ws: wss:");
    expect(headers["content-security-policy"], path).not.toContain("upgrade-insecure-requests");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
  }
  expect((await request.get("/_server/headers.json")).status()).toBe(404);
});

test("the Content Security Policy blocks scripts from elsewhere", async ({ browser }) => {
  // Its own context: this test breaks the policy on purpose.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  const violations = await page.evaluate(
    () =>
      new Promise<{ directive: string; blocked: string }[]>((resolve) => {
        const seen: { directive: string; blocked: string }[] = [];
        document.addEventListener("securitypolicyviolation", (event) =>
          seen.push({ directive: event.violatedDirective, blocked: event.blockedURI }),
        );
        const script = document.createElement("script");
        script.src = "https://example.org/evil.js";
        script.onerror = () => setTimeout(() => resolve(seen), 200);
        document.head.append(script);
      }),
  );
  expect(violations).toEqual([{ directive: "script-src-elem", blocked: "https://example.org/evil.js" }]);
  await context.close();
});
