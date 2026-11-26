/**
 * Writes the security headers of src/lib/site-security.ts where each home reads them:
 *
 *   node scripts/write-headers.mjs           → out/_server/headers.json, for the teacher's PC
 *                                              (fog/security.py). Run by `npm run build`; not on
 *                                              Vercel, which takes them from vercel.json.
 *   node scripts/write-headers.mjs --vercel  → the security rules in ../vercel.json
 *                                              (`npm run headers:vercel`; a test checks it's done).
 */
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));

/** site-security.ts, bundled by esbuild and imported (it's TypeScript, with "@/" imports). */
async function loadSiteSecurity() {
  const result = await build({
    entryPoints: [`${web}src/lib/site-security.ts`],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@": `${web}src` },
    logLevel: "warning",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const security = await loadSiteSecurity();

if (process.argv.includes("--vercel")) {
  const path = `${web}../vercel.json`;
  const config = JSON.parse(readFileSync(path, "utf8"));
  const isSecurityRule = (rule) => rule.source === "/(.*)" && (rule.has || rule.missing);
  config.headers = [
    ...security.vercelHeaderRules(),
    ...config.headers.filter((rule) => !isSecurityRule(rule)),
  ];
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write("vercel.json: security headers updated\n");
} else if (process.env.VERCEL) {
  process.stdout.write("Vercel: the security headers come from vercel.json\n");
} else {
  mkdirSync(`${web}out/_server`, { recursive: true });
  writeFileSync(
    `${web}out/_server/headers.json`,
    `${JSON.stringify(security.siteHeaders("classroom"), null, 2)}\n`,
  );
  process.stdout.write("Security headers for the teacher's PC: out/_server/headers.json\n");
}
