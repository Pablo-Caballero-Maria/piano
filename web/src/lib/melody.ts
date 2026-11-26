/**
 * Melodies as the REST API (pianocore/api.py) sends and stores them. Notes travel as text,
 * "p:s:d p:s:d …": MIDI note, start and duration in beats (4 decimals).
 */

/** A note of a melody: MIDI pitch p, start s and duration d in beats. */
export interface Note {
  p: number;
  s: number;
  d: number;
}

/** One line of a melody list (GET /api/melodies). */
export interface MelodySummary {
  id: string;
  name: string;
  bpm: number;
  length: number;
  noteCount: number;
  public: boolean;
  owner: string;
  editedBy?: string;
  /** When it was created and last saved (ms since 1970, the server's clock). */
  createdAt?: number;
  updatedAt: number;
}

/** A whole melody, notes decoded (GET /api/melodies/<id>). */
export interface Melody {
  id: string;
  name: string;
  bpm: number;
  notes: Note[];
  public: boolean;
  owner: string;
  editedBy?: string;
  updatedAt?: number;
}

/** What the page saves: a melody without the server's fields. */
export interface MelodyDraft {
  name: string;
  bpm: number;
  notes: readonly Note[];
  public: boolean;
}

/** The body of POST /api/melodies and PUT /api/melodies/<id>. */
export interface MelodyPayload {
  name: string;
  bpm: number;
  notes: string;
  length: number;
  public: boolean;
}

const num = (x: number): string => String(Math.round(x * 1e4) / 1e4);

/** Notes as text, "60:0:1 64:1.5:0.25". */
export const encodeNotes = (notes: readonly Note[]): string =>
  notes.map((n) => `${n.p}:${num(n.s)}:${num(n.d)}`).join(" ");

/** Notes from their text; damaged ones are dropped. */
export function decodeNotes(text: string): Note[] {
  return text
    .split(" ")
    .filter(Boolean)
    .map((t) => {
      const [p, s, d] = t.split(":").map(Number);
      return { p: p ?? NaN, s: s ?? NaN, d: d ?? NaN };
    })
    .filter((n) => Number.isInteger(n.p) && n.s >= 0 && n.d > 0);
}

/** Where the last note ends, in beats. */
export const melodyLength = (notes: readonly Note[]): number =>
  notes.reduce((end, n) => Math.max(end, n.s + n.d), 0);

export function toPayload(m: MelodyDraft): MelodyPayload {
  return {
    name: m.name,
    bpm: m.bpm,
    notes: encodeNotes(m.notes),
    length: melodyLength(m.notes),
    public: m.public,
  };
}
