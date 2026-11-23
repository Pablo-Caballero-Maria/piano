import { describe, expect, it } from "vitest";
import { isLive, isPage, type RequestInfo } from "@/sw/requests";

const info = (path: string, mode: string, sameOrigin = true): RequestInfo => ({
  url: new URL(path, "https://piano-esp32.duckdns.org"),
  request: { mode: mode as RequestMode, destination: "" as RequestDestination },
  sameOrigin,
});

describe("the service worker's routing", () => {
  it("never caches live data: the API, Better Auth, the board's files", () => {
    for (const path of [
      "/api/melodies",
      "/api/auth/get-session",
      "/board/abc/main.py",
      "/internal/accounts/find",
    ])
      expect(isLive(info(path, "cors"))).toBe(true);
    expect(isLive(info("/_next/static/chunks/a.js", "no-cors"))).toBe(false);
    expect(isLive(info("/api/melodies", "cors", false))).toBe(false);
  });

  it("treats navigations as the page", () => {
    expect(isPage(info("/#studio", "navigate"))).toBe(true);
    expect(isPage(info("/", "navigate", false))).toBe(false);
    expect(isPage(info("/icon.svg", "no-cors"))).toBe(false);
  });
});
