import { describe, expect, it } from "vitest";
import { describeMelody } from "@/components/studio/MelodiesDialog";

const M = {
  id: "m",
  name: "Song",
  bpm: 120,
  length: 12,
  noteCount: 1,
  public: true,
  owner: "ana",
  editedBy: "bo",
  updatedAt: Date.parse("2026-11-18T11:55:00Z"),
};

describe("a melody's line in the list", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  it("mine", () => {
    expect(describeMelody(M, true, now)).toBe(
      "public · 1 note · 0:06.0 · 120 BPM · 5 min ago (edited by bo)",
    );
  });
  it("someone else's", () => {
    expect(describeMelody({ ...M, editedBy: "ana" }, false, now)).toBe(
      "by ana · 1 note · 0:06.0 · 120 BPM · 5 min ago",
    );
  });
});
