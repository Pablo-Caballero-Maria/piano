// Unit and component tests (`npm test`): jsdom stands in for the browser.
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      // the page, and Better Auth's server (server/auth: its entry points only start it)
      include: ["src/**/*.{ts,tsx}", "server/**/*.ts"],
      exclude: ["server/auth/server.ts"],
      reporter: ["text-summary", "json-summary", "lcov", "html"],
    },
  },
});
