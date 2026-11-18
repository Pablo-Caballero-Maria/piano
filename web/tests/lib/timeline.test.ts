// The playback timeline: which notes sound when, and the buzzer's one frequency for them.
import { describe, expect, it } from "vitest";
import { freqOf, resultant } from "@/lib/notes";
import { buildSegments, segmentAt } from "@/lib/timeline";

const note = (id: number, p: number, s: number, d: number) => ({ id, p, s, d });

describe("timeline", () => {
  it("splits the melody where the set of sounding notes changes", () => {
    const segs = buildSegments([note(1, 60, 0, 2), note(2, 64, 1, 2)], 0);
    expect(segs.map((s) => [s.t0, s.t1, s.pitches])).toEqual([
      [0, 1, [60]],
      [1, 2, [60, 64]],
      [2, 3, [64]],
    ]);
    expect(segs[1]!.f).toBe(resultant([60, 64]));
    expect([...segs[1]!.ids]).toEqual([1, 2]);
  });

  it("silence between notes is a segment of its own", () => {
    const segs = buildSegments([note(1, 60, 0, 1), note(2, 62, 2, 1)], 0);
    expect(segs.map((s) => [s.t0, s.t1, s.f])).toEqual([
      [0, 1, freqOf(60)],
      [1, 2, 0],
      [2, 3, freqOf(62)],
    ]);
  });

  it("the same note struck again gets a short gap, so it's heard twice", () => {
    const segs = buildSegments([note(1, 60, 0, 1), note(2, 60, 1, 1)], 0.1);
    expect(segs.map((s) => [s.t0, +s.t1.toFixed(3), s.f])).toEqual([
      [0, 0.9, freqOf(60)],
      [0.9, 1, 0],
      [1, 2, freqOf(60)],
    ]);
  });

  it("the gap is never more than a third of the note before", () => {
    const segs = buildSegments([note(1, 60, 0, 0.3), note(2, 60, 0.3, 1)], 1);
    expect(segs[0]!.t1).toBeCloseTo(0.2);
  });

  it("finds the segment at a beat", () => {
    const segs = buildSegments([note(1, 60, 0, 1), note(2, 62, 2, 1)], 0);
    expect(segmentAt(segs, 0)?.pitches).toEqual([60]);
    expect(segmentAt(segs, 1.5)?.f).toBe(0);
    expect(segmentAt(segs, 2.99)?.pitches).toEqual([62]);
    expect(segmentAt(segs, 3)).toBeNull();
    expect(segmentAt([], 0)).toBeNull();
  });
});
