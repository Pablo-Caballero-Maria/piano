/**
 * /serwist/sw.js (and its source map): the service worker, src/sw/worker.ts bundled by esbuild at
 * build time with the build's files to precache (Serwist's Turbopack integration). Static: the
 * export writes it to out/serwist/, and the servers add `Service-Worker-Allowed: /` so it controls
 * the whole site (fog/website.py on the teacher's PC, vercel.json online).
 */
import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/sw/worker.ts",
  useNativeEsbuild: true,
  // A classic script (not a module): every browser with service workers can run it
  esbuildOptions: { format: "iife" },
});
