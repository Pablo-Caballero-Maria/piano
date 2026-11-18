import { describe, expect, it } from "vitest";
import { formatTime, plural, timeAgo } from "@/lib/format";

describe("format", () => {
  it("times", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(65.34)).toBe("1:05.3");
    expect(formatTime(9.96)).toBe("0:10.0");
  });

  it("how long ago", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(timeAgo("2026-11-18T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-18T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-18T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-01T09:00:00Z", now)).toBe(new Date("2026-11-01T09:00:00Z").toLocaleDateString());
  });

  it("plurals", () => {
    expect(plural(1, "note")).toBe("1 note");
    expect(plural(3, "note")).toBe("3 notes");
  });
});
