/**
 * End-to-end tests (`npm run test:e2e`): the built website (`npm run build` first) served by the
 * teacher's PC app with a simulated board (`python -m fog demo`), driven in real Chrome — several
 * browser contexts are several phones in the same class. Needs Chrome, or `npx playwright install
 * chromium` and PW_CHANNEL=chromium. The demo runs Better Auth as the PC does (a Node process), with
 * its per-address rate limit off: every phone here signs in from 127.0.0.1.
 */
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PIANO_E2E_PORT ?? 8091);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.PW_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `uv run --frozen python -m fog demo --port ${PORT} --fresh`,
    cwd: "..",
    // Ready once Better Auth answers through the PC app
    url: `http://127.0.0.1:${PORT}/api/auth/ok`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PIANO_AUTH_RATE_LIMIT: "off" },
  },
});
