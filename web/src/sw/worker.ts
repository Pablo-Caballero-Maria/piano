/// <reference lib="webworker" />
/**
 * The service worker (Serwist), built by src/app/serwist/[path]/route.ts into /serwist/sw.js and
 * registered by components/ui/ServiceWorker.tsx, so the page opens without a connection — a phone
 * that has lost the classroom's WiFi, or the online site without internet — and the piano, the
 * Studio and its draft keep working on the phone's own sound:
 *
 * - at install it precaches the build (the page's scripts and styles) and the page itself;
 * - the page: network first (an update shows up at once), the cached copy without a connection;
 * - the API, Better Auth and the board's files: always the network (the class, accounts and
 *   melodies need the PC or the internet);
 * - the rest: Serwist's defaults for Next.js.
 */
import { defaultCache } from "@serwist/turbopack/worker";
import { NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";
import { isLive, isPage } from "./requests";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const PAGES = "pages";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: isLive, handler: new NetworkOnly() },
    {
      matcher: isPage,
      handler: new NetworkFirst({
        cacheName: PAGES,
        networkTimeoutSeconds: 4,
        matchOptions: { ignoreSearch: true },
      }),
    },
    ...defaultCache,
  ],
});

// The page itself, so it opens offline even before it's reloaded once
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(PAGES).then((cache) => cache.add("/"))),
);
serwist.addEventListeners();
