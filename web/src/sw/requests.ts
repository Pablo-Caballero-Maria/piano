/**
 * Which requests the service worker (worker.ts) handles how. Pure functions of the request, so they
 * are tested without a service worker.
 */

/** What Serwist gives each runtime-caching matcher (the part used here). */
export interface RequestInfo {
  url: URL;
  request: Pick<Request, "mode" | "destination">;
  sameOrigin: boolean;
}

/**
 * Live data: the REST API and Better Auth (/api), the board's updates (/board) and the PC's
 * internal API. Always the network, never a cached copy.
 */
export const isLive = ({ url, sameOrigin }: RequestInfo): boolean =>
  sameOrigin && /^\/(api|board|internal)\//.test(url.pathname);

/** Opening or reloading the page (#piano, #studio: one page). */
export const isPage = ({ request, sameOrigin }: RequestInfo): boolean =>
  sameOrigin && request.mode === "navigate";
