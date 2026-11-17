// Note names, frequencies and the "resultant frequency" of overlapping notes (web/public/js/notes.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteName, freqOf, resultant, isBlack } from "../../web/public/js/notes.js";

test("names and frequencies", () => {
  assert.equal(noteName(60), "C4");
  assert.equal(noteName(70), "A#4");
  assert.equal(freqOf(69), 440);
  assert.equal(freqOf(60), 262);
  assert.ok(isBlack(61) && !isBlack(60));
});

test("overlapping notes play their mean frequency", () => {
  assert.equal(resultant([60, 64]), 296); // C4 + E4
  assert.equal(resultant([60, 60]), 262); // duplicates count once
  assert.equal(resultant([]), 0);
});
