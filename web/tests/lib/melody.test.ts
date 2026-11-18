// How melodies travel to the server and back.
import { describe, expect, it } from "vitest";
import { decodeNotes, encodeNotes, melodyLength, toPayload } from "@/lib/melody";

describe("melody text format", () => {
  it("notes round-trip through the text format", () => {
    const notes = [
      { p: 60, s: 0, d: 1 },
      { p: 64, s: 1.5, d: 0.25 },
      { p: 67, s: 1 / 3, d: 2 },
    ];
    const text = encodeNotes(notes);
    expect(text).toBe("60:0:1 64:1.5:0.25 67:0.3333:2");
    expect(decodeNotes(text)).toEqual([notes[0], notes[1], { p: 67, s: 0.3333, d: 2 }]);
  });

  it("damaged notes are dropped", () => {
    expect(decodeNotes("60:0:1  x:1:1 61:-1:1 62:0:0 63:2:1 64")).toEqual([
      { p: 60, s: 0, d: 1 },
      { p: 63, s: 2, d: 1 },
    ]);
    expect(decodeNotes("")).toEqual([]);
  });

  it("what is sent to the server", () => {
    const notes = [
      { p: 60, s: 0, d: 1 },
      { p: 62, s: 3, d: 1.5 },
    ];
    expect(melodyLength(notes)).toBe(4.5);
    expect(toPayload({ name: "Song", bpm: 90, notes, public: true })).toEqual({
      name: "Song",
      bpm: 90,
      notes: "60:0:1 62:3:1.5",
      length: 4.5,
      public: true,
    });
  });
});
