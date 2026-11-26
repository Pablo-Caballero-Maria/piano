/**
 * The tests' `test`: after each test, it fails if the page broke the Content Security Policy
 * anywhere (a blocked script, style, connection or eval), in any of the test's browser contexts:
 * the `context` fixture's and the "phones" helpers.ts opens.
 */
import { expect, test as base, type BrowserContext } from "@playwright/test";

/** The violations seen during the current test. */
const violations: string[] = [];

/** Reports every CSP violation of the context's pages (they don't always reach the console). */
export async function watchCsp(context: BrowserContext): Promise<void> {
  await context.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI}`),
    ),
  );
  context.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("CSP violation"))
      violations.push(message.text());
  });
}

export const test = base.extend<{ cspClean: void }>({
  context: async ({ context }, runTest) => {
    await watchCsp(context);
    await runTest(context);
  },
  cspClean: [
    async ({}, runTest) => {
      violations.length = 0;
      await runTest();
      expect(violations, "the page broke the Content Security Policy").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
