import type { TimedNote } from "@/lib/timeline";

/** A note in the editor: an id (on this page only) and, while being recorded, rec. */
export interface EditorNote extends TimedNote {
  rec?: boolean;
}

/** The melody in the editor. */
export interface EditorMelody {
  id: string | null;
  name: string;
  bpm: number;
  notes: EditorNote[];
  public: boolean;
  /** Who owns it (null: not saved yet, so mine). */
  owner: string | null;
}

export type Tool = "draw" | "erase";

/** What changed, for whoever shares the roll with the class: edits, play/stop/seek, a new melody. */
export type StudioChange = "edit" | "transport" | "load";
