/** The studio's work in progress, kept in this browser so a reload doesn't lose it. */
import type { Note } from "@/lib/melody";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/lib/storage";
import { DEFAULT_BPM } from "./constants";

export interface Draft {
  id: string | null;
  name: string;
  bpm: number;
  notes: Note[];
  public: boolean;
  owner: string | null;
  /** Changed since it was last saved or opened. */
  dirty: boolean;
}

export function loadDraft(): Draft | null {
  const d = readJSON<Partial<Draft>>(STORAGE_KEYS.studioDraft);
  if (!d || !Array.isArray(d.notes)) return null;
  return {
    id: d.id ?? null,
    name: d.name ?? "",
    bpm: d.bpm || DEFAULT_BPM,
    notes: d.notes,
    public: !!d.public,
    owner: d.owner ?? null,
    dirty: !!d.dirty,
  };
}

export const saveDraft = (draft: Draft): void => writeJSON(STORAGE_KEYS.studioDraft, draft);
