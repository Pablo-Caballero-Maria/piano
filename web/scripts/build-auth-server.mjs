/**
 * Bundles Better Auth's server for the teacher's PC (server/auth/server.ts) into one file,
 * out/_server/auth.mjs, that runs with nothing but Node.js: the PC app (fog/auth_server.py) starts
 * it. It goes inside out/ so that a tested update brings it along with the website (the PC's
 * updater installs out/ as a whole); the PC app never serves out/_server/.
 *
 * Run by `npm run build` after `next build`. Vercel runs Better Auth as a function (api/auth.ts)
 * and serves out/ as is: there the bundle isn't made.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

if (process.env.VERCEL) {
  process.stdout.write("Vercel: Better Auth runs as the function api/auth.ts; no bundle for the PC\n");
} else {
  const web = fileURLToPath(new URL("..", import.meta.url));
  await build({
    entryPoints: [`${web}server/auth/server.ts`],
    outfile: `${web}out/_server/auth.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    minify: true,
    legalComments: "none",
    // Some dependencies are CommonJS and call require(): give the ES module one
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  process.stdout.write("Better Auth for the teacher's PC: out/_server/auth.mjs\n");
}
