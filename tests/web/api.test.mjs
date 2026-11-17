// How melodies travel to the server and back (web/public/js/api.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeNotes, decodeNotes, checkCredentials } from "../../web/public/js/api.js";

test("notes round-trip through the text format", () => {
  const notes = [{ p: 60, s: 0, d: 1 }, { p: 64, s: 1.5, d: 0.25 }, { p: 67, s: 1 / 3, d: 2 }];
  const text = encodeNotes(notes);
  assert.equal(text, "60:0:1 64:1.5:0.25 67:0.3333:2");
  assert.deepEqual(decodeNotes(text), [notes[0], notes[1], { p: 67, s: 0.3333, d: 2 }]);
});

test("damaged notes are dropped", () => {
  assert.deepEqual(decodeNotes("60:0:1  x:1:1 61:-1:1 62:0:0 63:2:1"), [{ p: 60, s: 0, d: 1 }, { p: 63, s: 2, d: 1 }]);
  assert.deepEqual(decodeNotes(""), []);
});

test("credentials are checked before anything is sent", () => {
  assert.throws(() => checkCredentials("ab", "secret1"), /username/);
  assert.throws(() => checkCredentials("ana", "short"), /password/);
  checkCredentials("ana", "secret1");
});
