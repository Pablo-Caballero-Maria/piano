/**
 * The user's melodies: saving the studio's melody, opening one into it, copies and deletions
 * (through the REST API). Opening asks before throwing away unsaved notes; saving asks to log in
 * first if needed.
 */
import type { MelodySummary } from "@/lib/melody";
import { Emitter, Store } from "@/lib/store";
import type { ApiClient } from "@/services/api";
import type { ToastKind } from "@/state/toast";
import type { StudioEngine } from "./engine";

export type Scope = "mine" | "public";

export interface LibraryDeps {
  api: ApiClient;
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (message: string, okLabel: string) => Promise<boolean>;
  openAuth: (reason: string) => Promise<boolean>;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class MelodyLibrary {
  /** A save is under way. */
  readonly saving = new Store(false);
  /** A melody was saved, copied or deleted (lists should refresh). */
  readonly changed = new Emitter<void>();

  constructor(
    private readonly studio: StudioEngine,
    private readonly deps: LibraryDeps,
  ) {}

  /** Ask before throwing away unsaved notes. */
  private async okToDiscard(): Promise<boolean> {
    if (!this.studio.hasUnsavedNotes()) return true;
    return this.deps.confirm(`"${this.studio.displayName()}" has unsaved changes. Discard them?`, "Discard");
  }

  async newMelody(): Promise<void> {
    if (await this.okToDiscard()) this.studio.newMelody();
  }

  /** Save the studio's melody to my account (a new one if it was deleted meanwhile, or isn't mine). */
  async save(): Promise<void> {
    this.studio.stopRecording();
    if (this.studio.isFollowing() || this.saving.get()) return;
    const { api } = this.deps;
    if (
      !api.currentUser() &&
      !(await this.deps.openAuth("Log in or create an account to save your melodies."))
    ) {
      return;
    }
    const { id, draft } = this.studio.current();
    this.saving.set(true);
    try {
      let saved: MelodySummary;
      if (id) {
        try {
          saved = await api.updateMelody(id, draft);
        } catch (e) {
          if ((e as { status?: number }).status !== 404) throw e;
          saved = await api.createMelody(draft);
        }
      } else {
        saved = await api.createMelody(draft);
      }
      this.studio.markSaved(saved);
      this.deps.toast(`Saved "${saved.name}"`);
      this.changed.emit();
    } catch (e) {
      this.deps.toast(errorMessage(e), "error");
    } finally {
      this.saving.set(false);
    }
  }

  /** Log in if needed to see the melodies; false if the user didn't. */
  async ensureLoggedIn(): Promise<boolean> {
    return (
      !!this.deps.api.currentUser() || this.deps.openAuth("Log in to see your melodies and the public ones.")
    );
  }

  list(scope: Scope): Promise<MelodySummary[]> {
    return this.deps.api.listMelodies(scope);
  }

  /** Open a melody in the studio (and play it); true if it was opened. */
  async open(id: string, andPlay = false): Promise<boolean> {
    if (!(await this.okToDiscard())) return false;
    try {
      const m = await this.deps.api.getMelody(id);
      this.studio.load(m);
      if (andPlay) this.studio.play();
      return true;
    } catch (e) {
      this.deps.toast(errorMessage(e), "error");
      return false;
    }
  }

  /** Save a private copy of a melody (mine or someone's public one). */
  async duplicate(id: string): Promise<void> {
    try {
      const m = await this.deps.api.getMelody(id);
      const copy = await this.deps.api.createMelody({
        name: `${m.name} (copy)`.slice(0, 80),
        bpm: m.bpm,
        notes: m.notes,
        public: false,
      });
      this.deps.toast(`Saved "${copy.name}"`);
      this.changed.emit();
    } catch (e) {
      this.deps.toast(errorMessage(e), "error");
    }
  }

  /** Delete one of my melodies (the server checks it's mine). */
  async remove(m: MelodySummary): Promise<void> {
    try {
      await this.deps.api.deleteMelody(m.id);
      this.studio.forget(m.id);
      this.deps.toast(`Deleted "${m.name}"`);
      this.changed.emit();
    } catch (e) {
      this.deps.toast(errorMessage(e), "error");
    }
  }
}
