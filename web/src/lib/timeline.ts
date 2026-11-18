/**
 * The playback timeline of a melody: when each set of notes sounds, and the one frequency the
 * buzzer plays for it (their resultant, see notes.ts).
 */
import { resultant } from "./notes";

/** A note on the timeline: anything with a pitch, start and duration (in beats) and an id. */
export interface TimedNote {
  id: number;
  p: number;
  s: number;
  d: number;
}

/** From beat t0 to t1, these notes (ids) sound: pitches, and frequency f (0 = silence). */
export interface Segment {
  t0: number;
  t1: number;
  f: number;
  pitches: number[];
  ids: Set<number>;
}

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * Split the melody into segments where the same set of notes sounds, covering 0 up to the end of
 * the last note. If a note starts while the frequency stays the same (e.g. the same note twice in
 * a row), a short silence (gapBeats, at most a third of the segment before) goes before it so it
 * can be heard as a new note.
 */
export function buildSegments(notes: readonly TimedNote[], gapBeats: number): Segment[] {
  type Edge = [time: number, kind: 1 | -1, note: TimedNote];
  const edges: Edge[] = [];
  for (const n of notes) edges.push([r6(n.s), 1, n], [r6(n.s + n.d), -1, n]);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const raw: { t0: number; t1: number; notes: TimedNote[]; attack: boolean }[] = [];
  const sounding = new Set<TimedNote>();
  let t = 0;
  let attack = false;
  for (let k = 0; k < edges.length;) {
    const time = edges[k]![0];
    if (time > t) raw.push({ t0: t, t1: time, notes: [...sounding], attack });
    attack = false;
    for (; k < edges.length && edges[k]![0] === time; k++) {
      const [, kind, note] = edges[k]!;
      if (kind < 0) sounding.delete(note);
      else {
        sounding.add(note);
        attack = true;
      }
    }
    t = time;
  }

  const segments: Segment[] = [];
  for (const r of raw) {
    const pitches = [...new Set(r.notes.map((n) => n.p))];
    const seg: Segment = {
      t0: r.t0,
      t1: r.t1,
      f: resultant(pitches),
      pitches,
      ids: new Set(r.notes.map((n) => n.id)),
    };
    const prev = segments.at(-1);
    if (prev && r.attack && seg.f && seg.f === prev.f) {
      const gap = Math.min(gapBeats, (prev.t1 - prev.t0) / 3);
      prev.t1 -= gap;
      segments.push({ t0: prev.t1, t1: seg.t0, f: 0, pitches: [], ids: prev.ids });
    }
    segments.push(seg);
  }
  return segments;
}

/** The segment playing at beat `beat` (binary search), or null past the end. */
export function segmentAt(segments: readonly Segment[], beat: number): Segment | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid]!;
    if (beat < seg.t0) hi = mid - 1;
    else if (beat >= seg.t1) lo = mid + 1;
    else return seg;
  }
  return null;
}
