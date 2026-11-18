// Note names, frequencies and the "resultant frequency" of overlapping notes.
import { describe, expect, it } from "vitest";
import { exactFreq, freqOf, isBlack, noteName, noteNames, resultant } from "@/lib/notes";

describe("notes", () => {
  it("names and frequencies", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(70)).toBe("A#4");
    expect(noteName(24)).toBe("C1");
    expect(noteNames([60, 64, 67])).toBe("C4 E4 G4");
    expect(freqOf(69)).toBe(440);
    expect(freqOf(60)).toBe(262);
    expect(exactFreq(81)).toBeCloseTo(880);
    expect(isBlack(61) && !isBlack(60)).toBe(true);
  });

  it("overlapping notes play their mean frequency", () => {
    expect(resultant([60, 64])).toBe(296); // C4 + E4
    expect(resultant([60, 60])).toBe(262); // duplicates count once
    expect(resultant([])).toBe(0);
  });
});
