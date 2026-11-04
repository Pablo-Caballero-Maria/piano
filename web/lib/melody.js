// Melody documents: validation of what the browser sends, and the shape sent back.
// A melody is {name, bpm, notes: [{p, s, d}]}: p = MIDI note number, s = start and
// d = duration, both in beats (so changing the tempo keeps the rhythm).
import { ObjectId } from "mongodb";
import { HttpError } from "./http.js";

export const MAX_NOTES = 5000;
export const MAX_MELODIES = 500; // per user

const round = (x) => Math.round(x * 1e4) / 1e4;

/** Validate and normalize a melody from a request body, or throw a 400. */
export function parseMelody(b) {
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) throw new HttpError(400, "The name must be 1-80 characters");

  const bpm = Number(b.bpm);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) throw new HttpError(400, "The tempo must be 20-400 BPM");

  if (!Array.isArray(b.notes)) throw new HttpError(400, "notes must be a list");
  if (b.notes.length > MAX_NOTES) throw new HttpError(400, `At most ${MAX_NOTES} notes`);
  const notes = b.notes.map((n) => {
    const p = Number(n?.p), s = Number(n?.s), d = Number(n?.d);
    if (!Number.isInteger(p) || p < 0 || p > 127 || !(s >= 0 && s <= 1e5) || !(d > 0 && d <= 1e4))
      throw new HttpError(400, "Invalid note");
    return { p, s: round(s), d: Math.max(round(d), 1e-4) };
  });
  notes.sort((a, b) => a.s - b.s || a.p - b.p);
  return { name, bpm: round(bpm), notes };
}

/** Length of a melody in beats (end of its last note). */
export const lengthOf = (notes) => notes.reduce((m, n) => Math.max(m, n.s + n.d), 0);

/** A melody id from the URL as an ObjectId (a 404 if it isn't one). */
export function parseId(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{24}$/i.test(id)) throw new HttpError(404, "Melody not found");
  return new ObjectId(id);
}

/** The melody as sent to the browser (full, or without notes for lists). */
export function toClient(m, withNotes = true) {
  const out = {
    id: m._id.toHexString(),
    name: m.name,
    bpm: m.bpm,
    noteCount: m.noteCount,
    length: m.length,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
  if (withNotes) out.notes = m.notes;
  return out;
}
