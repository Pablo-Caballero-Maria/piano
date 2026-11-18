/**
 * What an on-screen piano keyboard is doing, without the DOM (components/keyboard draws it):
 * which keys are held by each pointer (mouse, fingers) and computer key, the octave, and how many
 * white keys fit. It only reports presses, onDown(midi) / onUp(midi); what sounds is up to the
 * mode using it (Piano: the last key pressed; Studio: the resultant of every held note).
 */
import { baseMidi, keyOffset, MAX_OCTAVE, MIN_OCTAVE, OCTAVE_DOWN, OCTAVE_UP } from "./keys";
import { Store } from "./store";

export interface KeyboardState {
  octave: number;
  /** White keys shown (0 until the keyboard has been measured). */
  whiteCount: number;
  /** Notes held down right now. */
  down: readonly number[];
}

/** The parts of a KeyboardEvent the keyboard uses. */
export type KeyEventLike = Pick<KeyboardEvent, "code" | "repeat" | "preventDefault">;

export interface KeyboardHandlers {
  onDown: (midi: number) => void;
  onUp: (midi: number) => void;
}

export class KeyboardController {
  readonly store: Store<KeyboardState>;
  /** pointerId → the note under it (0: not over a key). */
  private pointerNotes = new Map<number, number>();
  /** KeyboardEvent.code → note. */
  private keyNotes = new Map<string, number>();

  constructor(
    private handlers: KeyboardHandlers,
    octave = 4,
  ) {
    this.store = new Store<KeyboardState>({ octave, whiteCount: 0, down: [] });
  }

  setHandlers(handlers: KeyboardHandlers): void {
    this.handlers = handlers;
  }

  get state(): KeyboardState {
    return this.store.get();
  }

  private render(): void {
    const down = [...new Set([...this.pointerNotes.values(), ...this.keyNotes.values()])].filter(Boolean);
    const old = this.state.down;
    if (down.length !== old.length || down.some((m, i) => m !== old[i])) this.store.patch({ down });
  }

  /** Show `count` white keys (lets go of every key if it changes). */
  setWhiteCount(count: number): void {
    if (count === this.state.whiteCount) return;
    this.releaseAll();
    this.store.patch({ whiteCount: count });
  }

  /** Move the keyboard d octaves up/down (lets go of every key). */
  shift(d: number): void {
    const octave = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, this.state.octave + d));
    if (octave === this.state.octave) return;
    this.releaseAll();
    this.store.patch({ octave });
  }

  canShift(d: number): boolean {
    return d < 0 ? this.state.octave > MIN_OCTAVE : this.state.octave < MAX_OCTAVE;
  }

  // ---- Pointers: a finger or the mouse, over key `midi` (0: none) ---------------------------

  pointerDown(pointerId: number, midi: number): void {
    this.pointerNotes.set(pointerId, midi);
    if (midi) this.handlers.onDown(midi);
    this.render();
  }

  /** The pointer slid onto another key (a glissando). */
  pointerMove(pointerId: number, midi: number): void {
    if (!this.pointerNotes.has(pointerId)) return;
    const old = this.pointerNotes.get(pointerId);
    if (midi === old) return;
    this.pointerNotes.set(pointerId, midi);
    if (old) this.handlers.onUp(old);
    if (midi) this.handlers.onDown(midi);
    this.render();
  }

  /** A finger lifted, the mouse released, or the pointer lost: let go of its note. */
  pointerUp(pointerId: number): void {
    if (!this.pointerNotes.has(pointerId)) return;
    const old = this.pointerNotes.get(pointerId);
    this.pointerNotes.delete(pointerId);
    if (old) this.handlers.onUp(old);
    this.render();
  }

  isTracking(pointerId: number): boolean {
    return this.pointerNotes.has(pointerId);
  }

  // ---- Computer keys ------------------------------------------------------------------------

  /** Handle a keydown for the piano keys and Z / X (octave); true if it was one of them. */
  keyDown(e: KeyEventLike): boolean {
    if (e.code === OCTAVE_DOWN || e.code === OCTAVE_UP) {
      if (!e.repeat) this.shift(e.code === OCTAVE_DOWN ? -1 : 1);
      return true;
    }
    const offset = keyOffset(e.code);
    if (offset < 0) return false;
    e.preventDefault();
    if (e.repeat || this.keyNotes.has(e.code)) return true;
    const midi = baseMidi(this.state.octave) + offset;
    this.keyNotes.set(e.code, midi);
    this.handlers.onDown(midi);
    this.render();
    return true;
  }

  keyUp(e: Pick<KeyboardEvent, "code">): void {
    const midi = this.keyNotes.get(e.code);
    if (midi === undefined) return;
    this.keyNotes.delete(e.code);
    this.handlers.onUp(midi);
    this.render();
  }

  /** Let go of every key (mouse, touch and computer keys). */
  releaseAll(): void {
    const held = [...this.pointerNotes.values(), ...this.keyNotes.values()].filter(Boolean);
    this.pointerNotes.clear();
    this.keyNotes.clear();
    for (const m of held) this.handlers.onUp(m);
    this.render();
  }
}
