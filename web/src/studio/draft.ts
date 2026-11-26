/** The studio's work in progress, kept in this browser so a reload doesn't lose it. */
import type { Note } from "@/lib/melody";
import { readJSON, STORAGE_KEYS, writeJSON } from "@/lib/storage";
import { z } from "@/lib/zod";
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

/** A stored draft: only the notes are required (older versions of the page stored less). */
const storedDraftSchema = z.object({
  id: z.string().nullish(),
  name: z.string().optional(),
  bpm: z.number().optional(),
  notes: z.array(z.object({ p: z.number(), s: z.number(), d: z.number() })),
  public: z.boolean().optional(),
  owner: z.string().nullish(),
  dirty: z.boolean().optional(),
});

export function loadDraft(): Draft | null {
  const d = readJSON(STORAGE_KEYS.studioDraft, storedDraftSchema);
  if (!d) return null;
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
