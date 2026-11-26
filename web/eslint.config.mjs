// ESLint: Next.js's rules (React, hooks, accessibility, Core Web Vitals) and TypeScript's, with
// formatting left to Prettier.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  {
    // zod comes from src/lib/zod.ts, which keeps it from probing eval (the CSP forbids it).
    ignores: ["src/lib/zod.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "zod", message: 'Import z from "@/lib/zod" (zod without eval, for the CSP).' }] },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
]);
